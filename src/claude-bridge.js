import { spawn } from 'child_process';
import { sessionManager } from './session-manager.js';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';

/** @type {Map<string, import('child_process').ChildProcess>} */
const activeProcesses = new Map();

/**
 * Handle a WebSocket connection.
 * Protocol messages (JSON):
 *   → { type: 'send',    sessionId, content }
 *   → { type: 'cancel',  sessionId }
 *   → { type: 'flush',   sessionId }
 *   ← { type: 'chunk',   sessionId, data }
 *   ← { type: 'text',    sessionId, content }
 *   ← { type: 'done',    sessionId, exitCode }
 *   ← { type: 'error',   sessionId?, message }
 *   ← { type: 'status',  sessionId, status }
 */
export function handleWebSocket(ws) {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'send':
        handleSend(ws, msg.sessionId, msg.content);
        break;
      case 'cancel':
        handleCancel(ws, msg.sessionId);
        break;
      case 'flush':
        handleFlush(ws, msg.sessionId);
        break;
      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
    }
  });

  ws.on('close', () => {
    console.log('[ws] Client disconnected');
  });
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function handleSend(ws, sessionId, content) {
  const session = sessionManager.get(sessionId);
  if (!session) {
    send(ws, { type: 'error', message: 'Session not found' });
    return;
  }

  // Prevent concurrent messages in the same session
  if (activeProcesses.has(sessionId)) {
    send(ws, { type: 'error', sessionId, message: 'Session is busy. Cancel or wait.' });
    return;
  }

  // Store user message
  const userMsg = sessionManager.addMessage(sessionId, { role: 'user', content });
  send(ws, { type: 'user_message', sessionId, message: userMsg });

  sessionManager.setStatus(sessionId, 'running');
  send(ws, { type: 'status', sessionId, status: 'running' });

  // Build claude CLI args
  const args = [
    '-p', content,
    '--output-format', 'stream-json',
    '--session-id', session.claudeSessionId,
    '--verbose',
  ];

  // Add model flag if configured (e.g. "ollama:qwen3.5:9b")
  if (CLAUDE_MODEL) {
    args.push('--model', CLAUDE_MODEL);
  }

  console.log(`[claude] Spawning: ${CLAUDE_BIN} ${args.slice(0, 4).join(' ')}...`);
  if (CLAUDE_MODEL) console.log(`[claude] Model: ${CLAUDE_MODEL}`);
  console.log(`[claude] CWD: ${session.projectDir}`);

  let proc;
  try {
    proc = spawn(CLAUDE_BIN, args, {
      cwd: session.projectDir,
      env: { 
        ...process.env, 
        TERM: 'dumb', 
        NO_COLOR: '1',
        // Explicitly pass these to ensure Claude doesn't fall back to OAuth
        ...(process.env.ANTHROPIC_API_KEY && { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }),
        ...(process.env.ANTHROPIC_BASE_URL && { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    send(ws, { type: 'error', sessionId, message: `Failed to spawn claude: ${err.message}` });
    sessionManager.setStatus(sessionId, 'error');
    return;
  }

  activeProcesses.set(sessionId, proc);

  let fullResponse = '';

  // Stream stdout line by line
  let stdoutBuffer = '';
  proc.stdout.on('data', (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop(); // keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        send(ws, { type: 'chunk', sessionId, data: parsed });

        // Extract text content for message storage
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text') fullResponse += block.text;
          }
        }
        // Handle content_block_delta (streaming text)
        if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
          fullResponse += parsed.delta.text;
        }
      } catch {
        // Not JSON — send as raw text
        send(ws, { type: 'text', sessionId, content: line });
        fullResponse += line + '\n';
      }
    }
  });

  // Stream stderr
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    send(ws, { type: 'text', sessionId, content: text, stream: 'stderr' });
  });

  proc.on('error', (err) => {
    send(ws, { type: 'error', sessionId, message: err.message });
    sessionManager.setStatus(sessionId, 'error');
    activeProcesses.delete(sessionId);
  });

  proc.on('close', (code) => {
    // Flush remaining buffer
    if (stdoutBuffer.trim()) {
      try {
        const parsed = JSON.parse(stdoutBuffer);
        send(ws, { type: 'chunk', sessionId, data: parsed });
      } catch {
        send(ws, { type: 'text', sessionId, content: stdoutBuffer });
      }
    }

    // Store assistant response
    if (fullResponse.trim()) {
      sessionManager.addMessage(sessionId, { role: 'assistant', content: fullResponse });
    }

    sessionManager.setStatus(sessionId, code === 0 ? 'idle' : 'error');
    send(ws, { type: 'done', sessionId, exitCode: code });
    activeProcesses.delete(sessionId);
    console.log(`[claude] Process exited with code ${code}`);
  });
}

function handleCancel(ws, sessionId) {
  const proc = activeProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGTERM');
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL');
    }, 3000);
    send(ws, { type: 'status', sessionId, status: 'cancelled' });
  }
}

function handleFlush(ws, sessionId) {
  const session = sessionManager.flushContext(sessionId);
  if (session) {
    send(ws, {
      type: 'flushed',
      sessionId,
      newClaudeSessionId: session.claudeSessionId,
    });
    console.log(`[session] Context flushed for ${sessionId}`);
  } else {
    send(ws, { type: 'error', message: 'Session not found' });
  }
}
