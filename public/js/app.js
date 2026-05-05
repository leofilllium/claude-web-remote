/* ── Claude Web Remote — Frontend ─────────────────────── */

// Configure marked for markdown rendering
marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
});

// ── State ─────────────────────────────────────────────
const state = {
  ws: null,
  sessions: [],
  activeSessionId: null,
  connected: false,
  streaming: false,
  streamBuffer: '',
};

// ── DOM References ────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  sessionsList: $('#sessions-list'),
  messages: $('#messages'),
  welcomeScreen: $('#welcome-screen'),
  inputArea: $('#input-area'),
  messageInput: $('#message-input'),
  btnSend: $('#btn-send'),
  btnNewSession: $('#btn-new-session'),
  btnFlush: $('#btn-flush'),
  btnCancel: $('#btn-cancel'),
  btnSidebarToggle: $('#btn-sidebar-toggle'),
  btnSidebarClose: $('#btn-sidebar-close'),
  sidebar: $('#sidebar'),
  sidebarBackdrop: $('#sidebar-backdrop'),

  topbarName: $('#topbar-session-name'),
  topbarPath: $('#topbar-project-path'),
  modalOverlay: $('#modal-overlay'),
  inputSessionName: $('#input-session-name'),
  inputProjectDir: $('#input-project-dir'),
  btnModalCancel: $('#btn-modal-cancel'),
  btnModalCreate: $('#btn-modal-create'),
  projectSuggestions: $('#project-suggestions'),
  statusDot: $('.status-dot'),
  statusText: $('.status-text'),
};

// ── WebSocket ─────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${location.host}/ws`);

  state.ws.onopen = () => {
    state.connected = true;
    updateConnectionStatus();
    console.log('[ws] Connected');
  };

  state.ws.onclose = () => {
    state.connected = false;
    state.streaming = false;
    updateConnectionStatus();
    console.log('[ws] Disconnected, reconnecting in 3s...');
    setTimeout(connectWS, 3000);
  };

  state.ws.onerror = () => {
    state.connected = false;
    updateConnectionStatus();
  };

  state.ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleWSMessage(msg);
  };
}

function wsSend(payload) {
  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function updateConnectionStatus() {
  els.statusDot.classList.toggle('connected', state.connected);
  els.statusText.textContent = state.connected ? 'Connected' : 'Disconnected';
}

// ── WebSocket Message Handler ─────────────────────────
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'user_message':
      appendMessage('user', msg.message.content, msg.message.timestamp);
      break;

    case 'chunk':
      handleStreamChunk(msg.data);
      break;

    case 'text':
      appendToCurrentStream(msg.content);
      break;

    case 'done':
      finalizeStream(msg.exitCode);
      break;

    case 'error':
      appendSystemMessage(`❌ Error: ${msg.message}`, 'error');
      state.streaming = false;
      updateInputState();
      break;

    case 'status':
      updateSessionStatus(msg.sessionId, msg.status);
      break;

    case 'flushed':
      appendSystemMessage('🔄 Context flushed — new Claude session started.');
      loadSessions();
      break;
  }
}

// ── Streaming ─────────────────────────────────────────
let currentStreamEl = null;
let currentStreamText = '';

function handleStreamChunk(data) {
  if (!state.streaming) {
    state.streaming = true;
    currentStreamText = '';
    currentStreamEl = createStreamBubble();
    updateInputState();
  }

  // Handle different stream-json message types
  if (data.type === 'assistant' && data.message?.content) {
    for (const block of data.message.content) {
      if (block.type === 'text') {
        currentStreamText += block.text;
        renderStreamContent();
      }
    }
  } else if (data.type === 'content_block_delta' && data.delta?.text) {
    currentStreamText += data.delta.text;
    renderStreamContent();
  } else if (data.type === 'content_block_delta' && data.delta?.partial_json) {
    // Tool input streaming — ignore for main display
  } else if (data.type === 'tool_use' || (data.type === 'content_block_start' && data.content_block?.type === 'tool_use')) {
    const toolName = data.name || data.content_block?.name || 'Tool';
    const toolInput = data.input || data.content_block?.input || {};
    appendToolCard(toolName, toolInput);
  } else if (data.type === 'tool_result' || data.type === 'result') {
    // Could display result summary if needed
  }
}

function createStreamBubble() {
  removeWelcomeScreen();
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.innerHTML = `
    <div class="message-sender">Claude</div>
    <div class="message-bubble"><span class="streaming-dot"></span></div>
    <div class="message-time">${formatTime(Date.now())}</div>
  `;
  els.messages.appendChild(wrapper);
  scrollToBottom();
  return wrapper.querySelector('.message-bubble');
}

function renderStreamContent() {
  if (!currentStreamEl) return;
  try {
    currentStreamEl.innerHTML = marked.parse(currentStreamText) + '<span class="streaming-dot"></span>';
    // Highlight code blocks
    currentStreamEl.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  } catch {
    currentStreamEl.textContent = currentStreamText;
  }
  scrollToBottom();
}

function appendToCurrentStream(text) {
  if (!state.streaming) {
    state.streaming = true;
    currentStreamText = '';
    currentStreamEl = createStreamBubble();
    updateInputState();
  }
  currentStreamText += text;
  renderStreamContent();
}

function finalizeStream(exitCode) {
  state.streaming = false;
  // Remove streaming dot
  if (currentStreamEl) {
    const dot = currentStreamEl.querySelector('.streaming-dot');
    if (dot) dot.remove();
  }
  currentStreamEl = null;
  currentStreamText = '';
  updateInputState();
  loadSessions();

  if (exitCode !== 0 && exitCode !== null) {
    appendSystemMessage(`⚠️ Process exited with code ${exitCode}`, 'warning');
  }
}

function appendToolCard(toolName, input) {
  removeWelcomeScreen();
  const card = document.createElement('div');
  card.className = 'tool-card';

  let summary = '';
  if (typeof input === 'string') {
    summary = input.slice(0, 100);
  } else if (input.command) {
    summary = `$ ${input.command}`.slice(0, 100);
  } else if (input.file_path || input.path) {
    summary = input.file_path || input.path;
  } else {
    summary = JSON.stringify(input).slice(0, 80);
  }

  card.innerHTML = `
    <div class="tool-header" onclick="this.classList.toggle('open'); this.nextElementSibling.classList.toggle('open')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      <span>🔧 ${escapeHtml(toolName)}</span>
      <span style="color:var(--text-muted); font-weight:400; margin-left:8px">${escapeHtml(summary)}</span>
    </div>
    <div class="tool-body">${escapeHtml(typeof input === 'string' ? input : JSON.stringify(input, null, 2))}</div>
  `;

  els.messages.appendChild(card);
  scrollToBottom();
}

// ── Message Rendering ─────────────────────────────────
function appendMessage(role, content, timestamp) {
  removeWelcomeScreen();
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const senderName = role === 'user' ? 'You' : role === 'assistant' ? 'Claude' : 'System';
  let renderedContent;
  try {
    renderedContent = role === 'user' ? escapeHtml(content) : marked.parse(content);
  } catch {
    renderedContent = escapeHtml(content);
  }

  wrapper.innerHTML = `
    <div class="message-sender">${senderName}</div>
    <div class="message-bubble">${renderedContent}</div>
    <div class="message-time">${formatTime(timestamp || Date.now())}</div>
  `;

  // Highlight code blocks
  wrapper.querySelectorAll('pre code').forEach((block) => {
    hljs.highlightElement(block);
  });

  els.messages.appendChild(wrapper);
  scrollToBottom();
}

function appendSystemMessage(text, level = 'info') {
  removeWelcomeScreen();
  const wrapper = document.createElement('div');
  wrapper.className = 'message system';
  wrapper.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
  els.messages.appendChild(wrapper);
  scrollToBottom();
}

function removeWelcomeScreen() {
  if (els.welcomeScreen) {
    els.welcomeScreen.remove();
    els.welcomeScreen = null;
  }
}

// ── Sessions ──────────────────────────────────────────
async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    state.sessions = await res.json();
    renderSessions();
  } catch (err) {
    console.error('Failed to load sessions:', err);
  }
}

function renderSessions() {
  if (state.sessions.length === 0) {
    els.sessionsList.innerHTML = '<div class="empty-state">No sessions yet</div>';
    return;
  }

  els.sessionsList.innerHTML = state.sessions.map((s) => `
    <div class="session-item ${s.id === state.activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-status ${s.status}"></div>
      <div class="session-name">${escapeHtml(s.name)}</div>
      <div class="session-meta">${escapeHtml(s.projectDir.split('/').pop())} · ${s.messageCount} msgs</div>
      <button class="session-delete" data-id="${s.id}" title="Delete session">✕</button>
    </div>
  `).join('');

  // Bind click
  els.sessionsList.querySelectorAll('.session-item').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.session-delete')) return;
      selectSession(el.dataset.id);
    });
  });

  els.sessionsList.querySelectorAll('.session-delete').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      await deleteSession(el.dataset.id);
    });
  });
}

async function selectSession(id) {
  state.activeSessionId = id;
  const session = state.sessions.find((s) => s.id === id);

  els.topbarName.textContent = session?.name || 'Session';
  els.topbarPath.textContent = session?.projectDir || '';
  els.inputArea.style.display = '';
  els.btnFlush.disabled = false;

  renderSessions();

  // Load messages
  try {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    els.messages.innerHTML = '';
    els.welcomeScreen = null;

    if (data.messages.length === 0) {
      els.messages.innerHTML = `
        <div class="welcome-screen">
          <p style="color:var(--text-secondary)">Session ready. Send a message to begin.</p>
        </div>
      `;
    } else {
      for (const msg of data.messages) {
        appendMessage(msg.role, msg.content, msg.timestamp);
      }
    }
  } catch (err) {
    console.error('Failed to load messages:', err);
  }

  els.messageInput.focus();
}

async function createSession(name, projectDir) {
  try {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, projectDir }),
    });
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Failed to create session');
      return;
    }
    const session = await res.json();
    await loadSessions();
    selectSession(session.id);
  } catch (err) {
    alert('Failed to create session: ' + err.message);
  }
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (state.activeSessionId === id) {
    state.activeSessionId = null;
    els.topbarName.textContent = 'Select or create a session';
    els.topbarPath.textContent = '';
    els.inputArea.style.display = 'none';
    els.messages.innerHTML = `
      <div id="welcome-screen" class="welcome-screen">
        <div class="welcome-icon">⚡</div>
        <h1>Claude Remote</h1>
        <p>Remote interface for Claude Code CLI</p>
      </div>
    `;
    els.welcomeScreen = $('#welcome-screen');
  }
  await loadSessions();
}

function updateSessionStatus(sessionId, status) {
  const session = state.sessions.find((s) => s.id === sessionId);
  if (session) session.status = status;
  renderSessions();
  updateInputState();
}

// ── Send Message ──────────────────────────────────────
function sendMessage() {
  const content = els.messageInput.value.trim();
  if (!content || !state.activeSessionId || state.streaming) return;

  wsSend({
    type: 'send',
    sessionId: state.activeSessionId,
    content,
  });

  els.messageInput.value = '';
  els.messageInput.style.height = 'auto';
  updateInputState();
}

function updateInputState() {
  els.btnSend.disabled = state.streaming || !state.activeSessionId;
  els.btnCancel.disabled = !state.streaming;
  els.messageInput.disabled = state.streaming;

  if (state.streaming) {
    els.messageInput.placeholder = 'Waiting for Claude...';
  } else {
    els.messageInput.placeholder = 'Type a message or command...';
  }
}

// ── Modal ─────────────────────────────────────────────
function openModal() {
  els.modalOverlay.classList.remove('hidden');
  els.inputSessionName.value = '';
  els.inputProjectDir.value = '';
  els.inputSessionName.focus();
  loadProjectSuggestions();
}

function closeModal() {
  els.modalOverlay.classList.add('hidden');
}

async function loadProjectSuggestions() {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json();
    els.projectSuggestions.innerHTML = data.projects.slice(0, 12).map((p) => `
      <button class="project-chip ${p.hasClaude ? 'has-claude' : ''}" data-path="${escapeHtml(p.path)}">
        ${p.hasClaude ? '⚡' : '📁'} ${escapeHtml(p.name)}
      </button>
    `).join('');

    els.projectSuggestions.querySelectorAll('.project-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        els.inputProjectDir.value = chip.dataset.path;
        if (!els.inputSessionName.value) {
          els.inputSessionName.value = chip.textContent.trim().replace(/^[⚡📁]\s*/, '');
        }
      });
    });
  } catch {
    els.projectSuggestions.innerHTML = '';
  }
}

// ── Utilities ─────────────────────────────────────────
function scrollToBottom() {
  requestAnimationFrame(() => {
    els.messages.scrollTop = els.messages.scrollHeight;
  });
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Auto-resize textarea ──────────────────────────────
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Event Binding ─────────────────────────────────────
function bindEvents() {
  // Send
  els.btnSend.addEventListener('click', sendMessage);
  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  els.messageInput.addEventListener('input', () => autoResize(els.messageInput));

  // New Session
  els.btnNewSession.addEventListener('click', openModal);
  els.btnModalCancel.addEventListener('click', closeModal);
  els.btnModalCreate.addEventListener('click', () => {
    const name = els.inputSessionName.value.trim();
    const dir = els.inputProjectDir.value.trim();
    if (!dir) { alert('Project directory is required'); return; }
    createSession(name || dir.split('/').pop(), dir);
    closeModal();
  });
  els.modalOverlay.addEventListener('click', (e) => {
    if (e.target === els.modalOverlay) closeModal();
  });

  // Flush
  els.btnFlush.addEventListener('click', () => {
    if (!state.activeSessionId) return;
    if (confirm('Flush context? This starts a fresh Claude session while keeping chat history.')) {
      wsSend({ type: 'flush', sessionId: state.activeSessionId });
    }
  });

  // Cancel
  els.btnCancel.addEventListener('click', () => {
    if (!state.activeSessionId) return;
    wsSend({ type: 'cancel', sessionId: state.activeSessionId });
  });

  // Sidebar toggle
  const toggleSidebar = () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      els.sidebar.classList.toggle('open');
      els.sidebarBackdrop.classList.toggle('active');
    } else {
      els.sidebar.classList.toggle('collapsed');
    }
  };

  const closeSidebar = () => {
    els.sidebar.classList.remove('open');
    els.sidebar.classList.add('collapsed'); // For desktop if we want it to stay collapsed
    els.sidebarBackdrop.classList.remove('active');
  };

  els.btnSidebarToggle.addEventListener('click', toggleSidebar);
  els.btnSidebarClose.addEventListener('click', () => {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('active');
  });
  els.sidebarBackdrop.addEventListener('click', () => {
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('active');
  });


  // Quick commands
  $$('.cmd-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cmd = btn.dataset.cmd;
      els.messageInput.value = cmd;
      els.messageInput.focus();
      // If command has no trailing space (like /execute), send immediately
      if (!cmd.endsWith(' ')) {
        sendMessage();
      }
    });
  });

  // Keyboard shortcut: Escape to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// ── Init ──────────────────────────────────────────────
function init() {
  bindEvents();
  connectWS();
  loadSessions();
  updateInputState();
}

init();
