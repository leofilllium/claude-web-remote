import { v4 as uuidv4 } from 'uuid';

/**
 * In-memory session store.
 * Each session tracks: project directory, Claude session ID, messages, and status.
 */
class SessionManager {
  constructor() {
    /** @type {Map<string, Session>} */
    this.sessions = new Map();
  }

  create(projectDir, name = '') {
    const id = uuidv4();
    const session = {
      id,
      name: name || `Session ${this.sessions.size + 1}`,
      projectDir,
      claudeSessionId: uuidv4(),
      messages: [],
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.sessions.set(id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  list() {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, name, projectDir, status, createdAt, updatedAt, messages }) => ({
        id,
        name,
        projectDir,
        status,
        createdAt,
        updatedAt,
        messageCount: messages.length,
      }));
  }

  addMessage(sessionId, message) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const msg = {
      id: uuidv4(),
      ...message,
      timestamp: Date.now(),
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    return msg;
  }

  getMessages(sessionId) {
    const session = this.sessions.get(sessionId);
    return session ? session.messages : [];
  }

  setStatus(sessionId, status) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = Date.now();
    }
  }

  /**
   * Flush context: generates a new Claude session ID so the next message
   * starts a fresh context, while preserving chat history in the web UI.
   */
  flushContext(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const oldClaudeId = session.claudeSessionId;
    session.claudeSessionId = uuidv4();
    session.updatedAt = Date.now();
    this.addMessage(sessionId, {
      role: 'system',
      content: `Context flushed. Previous Claude session: ${oldClaudeId.slice(0, 8)}… → New session started.`,
    });
    return session;
  }

  delete(sessionId) {
    return this.sessions.delete(sessionId);
  }
}

export const sessionManager = new SessionManager();
