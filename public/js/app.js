/* ── Nexus — Frontend ──────────────────────────────────── */

marked.setOptions({
  highlight: (code, lang) => {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
    return hljs.highlightAuto(code).value;
  },
  breaks: true,
});

// ── State ──────────────────────────────────────────────
const state = { ws: null, sessions: [], activeSessionId: null, connected: false, streaming: false };

// ── DOM ────────────────────────────────────────────────
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
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
  btnModalClose: $('#btn-modal-close'),
  projectSuggestions: $('#project-suggestions'),
  statusDot: $('.status-dot'),
  statusText: $('.status-text'),
  sessionSearch: $('#session-search'),
  hintNew: $('#hint-new'),
  hintConnect: $('#hint-connect'),
};

// ── WebSocket ──────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${protocol}://${location.host}/ws`);
  state.ws.onopen = () => { state.connected = true; updateConnectionStatus(); };
  state.ws.onclose = () => { state.connected = false; state.streaming = false; updateConnectionStatus(); setTimeout(connectWS, 3000); };
  state.ws.onerror = () => { state.connected = false; updateConnectionStatus(); };
  state.ws.onmessage = (e) => handleWSMessage(JSON.parse(e.data));
}

function wsSend(p) { if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(p)); }

function updateConnectionStatus() {
  els.statusDot.classList.toggle('connected', state.connected);
  els.statusText.textContent = state.connected ? 'Connected' : 'Offline';
}

// ── WS Handler ─────────────────────────────────────────
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'user_message': appendMessage('user', msg.message.content, msg.message.timestamp); break;
    case 'chunk': handleStreamChunk(msg.data); break;
    case 'text': appendToCurrentStream(msg.content); break;
    case 'done': finalizeStream(msg.exitCode); break;
    case 'error': appendSystemMessage(`❌ ${msg.message}`); state.streaming = false; updateInputState(); break;
    case 'status': updateSessionStatus(msg.sessionId, msg.status); break;
    case 'flushed': appendSystemMessage('↻ Context flushed'); loadSessions(); break;
  }
}

// ── Streaming ──────────────────────────────────────────
let currentStreamEl = null, currentStreamText = '';

function handleStreamChunk(data) {
  if (!state.streaming) { state.streaming = true; currentStreamText = ''; currentStreamEl = createStreamBubble(); updateInputState(); }
  if (data.type === 'assistant' && data.message?.content) {
    for (const b of data.message.content) { if (b.type === 'text') { currentStreamText += b.text; renderStreamContent(); } }
  } else if (data.type === 'content_block_delta' && data.delta?.text) {
    currentStreamText += data.delta.text; renderStreamContent();
  } else if (data.type === 'tool_use' || (data.type === 'content_block_start' && data.content_block?.type === 'tool_use')) {
    appendToolCard(data.name || data.content_block?.name || 'Tool', data.input || data.content_block?.input || {});
  }
}

function createStreamBubble() {
  removeWelcomeScreen();
  const w = document.createElement('div'); w.className = 'message assistant';
  w.innerHTML = `<div class="message-sender">Agent</div><div class="message-bubble"><span class="streaming-dot"></span></div><div class="message-time">${fmtTime(Date.now())}</div>`;
  els.messages.appendChild(w); scrollBottom();
  return w.querySelector('.message-bubble');
}

function renderStreamContent() {
  if (!currentStreamEl) return;
  try { currentStreamEl.innerHTML = marked.parse(currentStreamText) + '<span class="streaming-dot"></span>'; currentStreamEl.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b)); }
  catch { currentStreamEl.textContent = currentStreamText; }
  scrollBottom();
}

function appendToCurrentStream(text) {
  if (!state.streaming) { state.streaming = true; currentStreamText = ''; currentStreamEl = createStreamBubble(); updateInputState(); }
  currentStreamText += text; renderStreamContent();
}

function finalizeStream(code) {
  state.streaming = false;
  if (currentStreamEl) { const d = currentStreamEl.querySelector('.streaming-dot'); if (d) d.remove(); }
  currentStreamEl = null; currentStreamText = ''; updateInputState(); loadSessions();
  if (code !== 0 && code !== null) appendSystemMessage(`⚠ Exit code ${code}`);
}

function appendToolCard(name, input) {
  removeWelcomeScreen();
  const c = document.createElement('div'); c.className = 'tool-card';
  let s = typeof input === 'string' ? input.slice(0, 80) : (input.command ? `$ ${input.command}`.slice(0, 80) : (input.file_path || input.path || JSON.stringify(input).slice(0, 60)));
  c.innerHTML = `<div class="tool-header" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg><span>⚙ ${esc(name)}</span><span style="color:var(--tx-3);font-weight:400;margin-left:6px">${esc(s)}</span></div><div class="tool-body">${esc(typeof input === 'string' ? input : JSON.stringify(input, null, 2))}</div>`;
  els.messages.appendChild(c); scrollBottom();
}

// ── Messages ───────────────────────────────────────────
function appendMessage(role, content, ts) {
  removeWelcomeScreen();
  const w = document.createElement('div'); w.className = `message ${role}`;
  const sender = role === 'user' ? 'You' : 'Agent';
  let html; try { html = role === 'user' ? esc(content) : marked.parse(content); } catch { html = esc(content); }
  w.innerHTML = `<div class="message-sender">${sender}</div><div class="message-bubble">${html}</div><div class="message-time">${fmtTime(ts || Date.now())}</div>`;
  w.querySelectorAll('pre code').forEach(b => hljs.highlightElement(b));
  els.messages.appendChild(w); scrollBottom();
}

function appendSystemMessage(text) {
  removeWelcomeScreen();
  const w = document.createElement('div'); w.className = 'message system';
  w.innerHTML = `<div class="message-bubble">${esc(text)}</div>`;
  els.messages.appendChild(w); scrollBottom();
}

function removeWelcomeScreen() { if (els.welcomeScreen) { els.welcomeScreen.remove(); els.welcomeScreen = null; } }

// ── Sessions ───────────────────────────────────────────
async function loadSessions() {
  try { const r = await fetch('/api/sessions'); state.sessions = await r.json(); renderSessions(); } catch (e) { console.error(e); }
}

function renderSessions(filter = '') {
  const filtered = filter ? state.sessions.filter(s => s.name.toLowerCase().includes(filter)) : state.sessions;
  if (filtered.length === 0) {
    els.sessionsList.innerHTML = `<div class="empty-state"><div class="empty-icon">◇</div><p>${filter ? 'No matches' : 'No sessions'}</p><span>Tap <strong>+</strong> to begin</span></div>`;
    return;
  }
  els.sessionsList.innerHTML = filtered.map(s => `
    <div class="session-item ${s.id === state.activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-status ${s.status}"></div>
      <div class="session-name">${esc(s.name)}</div>
      <div class="session-meta">${esc(s.projectDir.split('/').pop())} · ${s.messageCount} msgs</div>
      <button class="session-delete" data-id="${s.id}" title="Delete">✕</button>
    </div>
  `).join('');
  els.sessionsList.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', e => { if (!e.target.closest('.session-delete')) { selectSession(el.dataset.id); closeSidebar(); } });
  });
  els.sessionsList.querySelectorAll('.session-delete').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); deleteSession(el.dataset.id); });
  });
}

async function selectSession(id) {
  state.activeSessionId = id;
  const s = state.sessions.find(x => x.id === id);
  els.topbarName.textContent = s?.name || 'Session';
  els.topbarPath.textContent = s?.projectDir || '';
  els.inputArea.style.display = '';
  els.btnFlush.disabled = false;
  renderSessions();
  try {
    const r = await fetch(`/api/sessions/${id}`); const d = await r.json();
    els.messages.innerHTML = ''; els.welcomeScreen = null;
    if (d.messages.length === 0) { els.messages.innerHTML = `<div class="welcome-screen"><p style="color:var(--tx-2)">Session ready. Send a message.</p></div>`; }
    else { for (const m of d.messages) appendMessage(m.role, m.content, m.timestamp); }
  } catch (e) { console.error(e); }
  els.messageInput.focus();
}

async function createSession(name, dir) {
  try {
    const r = await fetch('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, projectDir: dir }) });
    if (!r.ok) { const e = await r.json(); alert(e.error || 'Failed'); return; }
    const s = await r.json(); await loadSessions(); selectSession(s.id);
  } catch (e) { alert(e.message); }
}

async function deleteSession(id) {
  if (!confirm('Delete this session?')) return;
  await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (state.activeSessionId === id) {
    state.activeSessionId = null; els.topbarName.textContent = 'Select a session'; els.topbarPath.textContent = '';
    els.inputArea.style.display = 'none';
    els.messages.innerHTML = `<div id="welcome-screen" class="welcome-screen"><div class="welcome-glyph"><div class="glyph-ring"></div><div class="glyph-core">N</div></div><h1>Nexus</h1><p class="welcome-tagline">Your remote code terminal</p></div>`;
    els.welcomeScreen = $('#welcome-screen');
  }
  await loadSessions();
}

function updateSessionStatus(sid, status) {
  const s = state.sessions.find(x => x.id === sid); if (s) s.status = status;
  renderSessions(); updateInputState();
}

// ── Send ───────────────────────────────────────────────
function sendMessage() {
  const c = els.messageInput.value.trim();
  if (!c || !state.activeSessionId || state.streaming) return;
  wsSend({ type: 'send', sessionId: state.activeSessionId, content: c });
  els.messageInput.value = ''; els.messageInput.style.height = 'auto'; updateInputState();
}

function updateInputState() {
  els.btnSend.disabled = state.streaming || !state.activeSessionId;
  els.btnCancel.disabled = !state.streaming;
  els.messageInput.disabled = state.streaming;
  els.messageInput.placeholder = state.streaming ? 'Processing…' : 'Message…';
}

// ── Modal ──────────────────────────────────────────────
function openModal() { els.modalOverlay.classList.remove('hidden'); els.inputSessionName.value = ''; els.inputProjectDir.value = ''; els.inputSessionName.focus(); loadProjectSuggestions(); }
function closeModal() { els.modalOverlay.classList.add('hidden'); }

async function loadProjectSuggestions() {
  try {
    const r = await fetch('/api/projects'); const d = await r.json();
    els.projectSuggestions.innerHTML = d.projects.slice(0, 12).map(p => `<button class="project-chip ${p.hasClaude ? 'has-claude' : ''}" data-path="${esc(p.path)}">${p.hasClaude ? '⚡' : '◇'} ${esc(p.name)}</button>`).join('');
    els.projectSuggestions.querySelectorAll('.project-chip').forEach(c => {
      c.addEventListener('click', () => { els.inputProjectDir.value = c.dataset.path; if (!els.inputSessionName.value) els.inputSessionName.value = c.textContent.trim().replace(/^[⚡◇]\s*/, ''); });
    });
  } catch { els.projectSuggestions.innerHTML = ''; }
}

// ── Sidebar ────────────────────────────────────────────
function closeSidebar() {
  const mob = window.innerWidth <= 768;
  if (mob) { els.sidebar.classList.remove('open'); els.sidebarBackdrop.classList.remove('active'); }
}

// ── Util ───────────────────────────────────────────────
function scrollBottom() { requestAnimationFrame(() => { els.messages.scrollTop = els.messages.scrollHeight; }); }
function fmtTime(t) { return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function autoResize(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 110) + 'px'; }

// ── Events ─────────────────────────────────────────────
function bindEvents() {
  els.btnSend.addEventListener('click', sendMessage);
  els.messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
  els.messageInput.addEventListener('input', () => autoResize(els.messageInput));

  els.btnNewSession.addEventListener('click', openModal);
  els.btnModalCancel.addEventListener('click', closeModal);
  if (els.btnModalClose) els.btnModalClose.addEventListener('click', closeModal);
  els.btnModalCreate.addEventListener('click', () => {
    const n = els.inputSessionName.value.trim(), d = els.inputProjectDir.value.trim();
    if (!d) { alert('Directory required'); return; }
    createSession(n || d.split('/').pop(), d); closeModal();
  });
  els.modalOverlay.addEventListener('click', e => { if (e.target === els.modalOverlay) closeModal(); });

  els.btnFlush.addEventListener('click', () => { if (state.activeSessionId && confirm('Flush context?')) wsSend({ type: 'flush', sessionId: state.activeSessionId }); });
  els.btnCancel.addEventListener('click', () => { if (state.activeSessionId) wsSend({ type: 'cancel', sessionId: state.activeSessionId }); });

  // Sidebar
  els.btnSidebarToggle.addEventListener('click', () => {
    const mob = window.innerWidth <= 768;
    if (mob) { els.sidebar.classList.toggle('open'); els.sidebarBackdrop.classList.toggle('active'); }
    else { els.sidebar.classList.toggle('collapsed'); }
  });
  els.btnSidebarClose.addEventListener('click', closeSidebar);
  els.sidebarBackdrop.addEventListener('click', closeSidebar);

  // Session search
  if (els.sessionSearch) els.sessionSearch.addEventListener('input', () => renderSessions(els.sessionSearch.value.trim().toLowerCase()));

  // Quick commands
  $$('.cmd-chip').forEach(b => {
    b.addEventListener('click', () => { els.messageInput.value = b.dataset.cmd; els.messageInput.focus(); if (!b.dataset.cmd.endsWith(' ')) sendMessage(); });
  });

  // Welcome hints
  if (els.hintNew) els.hintNew.addEventListener('click', openModal);
  if (els.hintConnect) els.hintConnect.addEventListener('click', openModal);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── Init ───────────────────────────────────────────────
bindEvents(); connectWS(); loadSessions(); updateInputState();
