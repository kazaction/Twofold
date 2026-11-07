import { Vault } from './vault.js';
import { processFile } from './media.js';

const vault = new Vault();
window.__vault = vault; // handy for debugging in the console

// ---------------- helpers ----------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isTouch = matchMedia('(pointer: coarse)').matches;
const fmtSize = (n) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtFull = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
function fmtDay(ts) {
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtFull(ts);
}
const SAFE_THUMB = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
function linkify(escaped) {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

const ICONS = {
  plus: '<path d="M5 12h14M12 5v14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sync: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  settings: '<path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4M12 2v13"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  backspace: '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6M12 9l6 6"/>',
  timeline: '<path d="M2 12h20"/><circle cx="7" cy="12" r="2.2"/><circle cx="17" cy="12" r="2.2"/><path d="M7 9.8V5M17 14.2V19"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}

// ---------------- modals ----------------
let modalStack = [];
function modal(html, { cls = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `modal-wrap ${cls}`;
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => {
    if (!wrap.isConnected) return;
    wrap.remove();
    modalStack = modalStack.filter((m) => m !== entry);
    onClose?.();
  };
  const entry = { wrap, close };
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  $('#modal-root').append(wrap);
  modalStack.push(entry);
  setTimeout(() => wrap.querySelector('[autofocus]')?.focus(), 30);
  return { el: wrap.firstElementChild, close };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(); });

function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let answered = false;
    const m = modal(`
      <h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`,
    { onClose: () => { if (!answered) res(false); } });
    m.el.querySelector('[data-ok]').onclick = () => { answered = true; m.close(); res(true); };
  });
}

// ---------------- boot ----------------
const ui = { chat: localStorage.getItem('tf.chat'), view: localStorage.getItem('tf.view') === 'calendar' ? 'calendar' : 'chat', win: 150, sidebar: false, tray: [], busy: false, unlocked: new Set(), calMonth: null, calDay: null };
const chatIcon = (c) => (c.emoji ? esc(c.emoji) : icon(c.kind === 'timeline' ? 'timeline' : 'hash'));
const isLocked = (c) => c && c.locked && !ui.unlocked.has(c.id);

async function start() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  let state;
  try { state = await vault.boot(); }
  catch (e) { console.error(e); state = 'setup'; }
  if (state === 'setup') renderSetup();
  else if (state === 'locked') renderLocked();
  else enterApp();
}

// ---------------- setup screens ----------------
function renderSetup(tab = 'new', prefill = '') {
  const app = $('#app');
  app.innerHTML = `
  <div class="setup">
    <div class="setup-card">
      <div class="setup-brand"><div class="logo-mark"></div><div><h1>Twofold</h1><p class="muted">A private, encrypted archive for two – stored in your own GitHub repo.</p></div></div>
      <div class="tabs">
        <button class="tab ${tab === 'new' ? 'on' : ''}" data-tab="new">Start a new vault</button>
        <button class="tab ${tab === 'join' ? 'on' : ''}" data-tab="join">Join with a setup code</button>
      </div>
      <div class="tab-body"></div>
    </div>
  </div>`;
  $$('.tab', app).forEach((b) => b.onclick = () => renderSetup(b.dataset.tab));
  const body = $('.tab-body', app);
  if (tab === 'new') {
    body.innerHTML = `
      <details class="help">
        <summary>First time? How to make the repo and token (2 min)</summary>
        <ol>
          <li>On GitHub create a <b>new private repository</b> (e.g. <code>our-vault</code>). Tick “Add a README”.</li>
          <li>Go to <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
          <li>Repository access: <b>Only select repositories</b> → pick the vault repo.</li>
          <li>Permissions → Repository → <b>Contents: Read and write</b>. Nothing else is needed.</li>
          <li>Pick a long expiration, generate, and paste the token below. It is stored only on this device.</li>
        </ol>
      </details>
      <label>Your name<input id="s-name" maxlength="40" placeholder="e.g. Kiko" autocomplete="nickname"></label>
      <label>Repository<input id="s-repo" placeholder="username/our-vault" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>Branch<input id="s-branch" value="main" autocapitalize="off" spellcheck="false"></label>
      <label>GitHub token<input id="s-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false"></label>
      <button class="btn primary wide" id="s-go">Create vault</button>
      <p class="status muted" id="s-status"></p>`;
    $('#s-go').onclick = async () => {
      const name = $('#s-name').value.trim(), repo = $('#s-repo').value.trim(), branch = $('#s-branch').value.trim() || 'main', token = $('#s-token').value.trim();
      if (!name || !repo || !token) return setStatus('Fill in your name, the repository and the token.', true);
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''))) return setStatus('Repository should look like username/repo-name', true);
      busy(true, 'Creating vault…');
      try {
        const info = await vault.createNew({ repo, branch, token, name });
        if (info && info.private === false) toast('Warning: this repo is PUBLIC. Contents are encrypted, but make it private.', 'warn');
        enterApp();
      } catch (e) { console.error(e); await vault.wipeDevice().catch(() => {}); setStatus(e.message, true); busy(false); }
    };
  } else {
    body.innerHTML = `
      <p class="muted small">On a device that already has the vault, open <b>Settings → Add a device</b> and scan or copy the setup code.</p>
      <label>Setup code<textarea id="j-code" rows="4" placeholder="TF1.…" spellcheck="false" autocapitalize="off">${esc(prefill)}</textarea></label>
      <button class="btn ghost wide" id="j-scan">${icon('camera')} Scan QR code</button>
      <label id="j-name-l">Your name<input id="j-name" maxlength="40" autocomplete="nickname"></label>
      <label id="j-token-l">GitHub token<input id="j-token" type="password" placeholder="github_pat_…" autocomplete="off"></label>
      <button class="btn primary wide" id="j-go">Join vault</button>
      <p class="status muted" id="j-status"></p>`;
    const refresh = () => {
      let c = null;
      try { c = Vault.parseCode($('#j-code').value); } catch {}
      $('#j-name-l').hidden = !!c?.p;
      $('#j-token-l').hidden = !!c?.t;
      if (c?.p) $('#j-status').textContent = `This code adds a device for ${c.p.n}.`;
      else if (c) $('#j-status').textContent = 'This code invites a new person.';
      else $('#j-status').textContent = '';
    };
    $('#j-code').oninput = refresh;
    refresh();
    $('#j-scan').onclick = () => scanQR((code) => { $('#j-code').value = code; refresh(); });
    $('#j-go').onclick = async () => {
      const code = $('#j-code').value;
      let c;
      try { c = Vault.parseCode(code); } catch (e) { return setStatus(e.message, true); }
      const name = $('#j-name').value.trim();
      if (!c.p && !name) return setStatus('Enter your name.', true);
      busy(true, 'Joining and downloading the archive…');
      try { await vault.join(code, { name, token: $('#j-token').value.trim() }); enterApp(); }
      catch (e) { console.error(e); await vault.wipeDevice().catch(() => {}); setStatus(e.message, true); busy(false); }
    };
  }
  function setStatus(t, bad) { const s = $('.status', body); s.textContent = t; s.classList.toggle('bad', !!bad); }
  function busy(on, t) { $$('button, input, textarea', body).forEach((x) => x.disabled = on); if (t) setStatus(t); }
}

function renderLocked() {
  $('#app').innerHTML = `
  <div class="setup"><div class="setup-card narrow">
    <div class="setup-brand"><div class="logo-mark"></div><div><h1>Locked</h1><p class="muted">Enter your passphrase to open the vault.</p></div></div>
    <form id="u-form"><label>Passphrase<input id="u-pass" type="password" autocomplete="current-password" autofocus></label>
    <button class="btn primary wide">Unlock</button></form>
    <p class="status bad" id="u-status"></p>
    <button class="link small" id="u-forgot">Forgot it? Remove the vault from this device</button>
  </div></div>`;
  setTimeout(() => $('#u-pass').focus(), 50);
  $('#u-form').onsubmit = async (e) => {
    e.preventDefault();
    $('#u-status').textContent = '';
    try { await vault.unlock($('#u-pass').value); enterApp(); }
    catch (err) { $('#u-status').textContent = err.message; }
  };
  $('#u-forgot').onclick = async () => {
    if (await confirmBox('Remove vault from this device?', 'Everything already synced is safe in the repo. Anything not yet synced from this device will be lost. You can join again with a setup code.', 'Remove', true)) {
      await vault.wipeDevice(); location.reload();
    }
  };
}

// ---------------- main app ----------------
function enterApp() {
  $('#app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="side-head">
        <div class="brand"><div class="logo-mark sm"></div><span>Twofold</span></div>
        <button class="icon-btn" id="newChat" title="New channel">${icon('plus')}</button>
      </div>
      <button class="search-pill" id="openSearch">${icon('search')}<span>Search archive</span></button>
      <nav class="chat-list" id="chatList"></nav>
      <div class="side-foot">
        <div class="me"><div class="avatar" id="meAvatar"></div><div class="me-text"><div class="me-name" id="meName"></div><div class="muted small" id="syncLine"></div></div></div>
        <button class="icon-btn" id="openSettings" title="Settings">${icon('settings')}</button>
      </div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="chat" id="chatPane">
      <header class="chat-head">
        <button class="icon-btn only-mobile" id="menuBtn" title="Chats">${icon('menu')}</button>
        <div class="chat-title" id="chatTitle"></div>
        <button class="icon-btn" id="mediaBtn" title="Media">${icon('image')}</button>
        <button class="icon-btn" id="infoBtn" title="Chat info">${icon('info')}</button>
        <button class="sync-btn" id="syncBtn" title="Sync (pull + push)">${icon('sync', 'sync-ic')}<span>Sync</span><b class="badge" id="syncBadge"></b></button>
      </header>
      <div class="messages" id="messages"></div>
      <div class="tray" id="tray"></div>
      <form class="composer" id="composer">
        <button type="button" class="icon-btn" id="attachBtn" title="Attach">${icon('clip')}</button>
        <input type="file" id="fileInput" multiple hidden>
        <textarea id="input" rows="1" placeholder="Write something…" enterkeyhint="${isTouch ? 'enter' : 'send'}"></textarea>
        <button class="send-btn" id="sendBtn" title="Send">${icon('send')}</button>
      </form>
    </main>
  </div>`;

  $('#newChat').onclick = () => chatDialog();
  $('#openSearch').onclick = searchDialog;
  $('#openSettings').onclick = settingsDialog;
  $('#menuBtn').onclick = () => setSidebar(true);
  $('#scrim').onclick = () => setSidebar(false);
  $('#infoBtn').onclick = () => ui.chat && chatDialog(ui.chat);
  $('#mediaBtn').onclick = () => ui.chat && mediaDialog(ui.chat);
  $('#syncBtn').onclick = () => doSync(true);
  $('#chatList').onclick = (e) => {
    if (e.target.closest('[data-cal]')) { openCalendar(); setSidebar(false); return; }
    const a = e.target.closest('[data-chat]');
    if (a) {
      const c = vault.chats.get(a.dataset.chat);
      if (isLocked(c)) unlockChat(c.id);
      else { openChat(a.dataset.chat); setSidebar(false); }
    }
    const t = e.target.closest('[data-toggle-hidden]');
    if (t) { ui.showHidden = !ui.showHidden; renderSidebar(); }
  };
  $('#messages').addEventListener('click', onMessageClick);
  $('#messages').addEventListener('contextmenu', (e) => {
    const m = e.target.closest('.msg');
    if (m && !e.target.closest('a')) { e.preventDefault(); messageMenu(m.dataset.id); }
  });
  // long-press on touch devices opens the message menu (iOS doesn't fire contextmenu)
  let lp = null;
  $('#messages').addEventListener('touchstart', (e) => {
    const m = e.target.closest('.msg');
    if (!m || e.target.closest('a, [data-act]') || e.touches.length > 1) return;
    const { clientX: x, clientY: y } = e.touches[0];
    lp = { x, y, t: setTimeout(() => { lp = null; navigator.vibrate?.(10); messageMenu(m.dataset.id); }, 480) };
  }, { passive: true });
  const cancelLp = (e) => {
    if (!lp) return;
    if (e.type === 'touchmove') {
      const t = e.touches[0];
      if (Math.hypot(t.clientX - lp.x, t.clientY - lp.y) < 10) return;
    }
    clearTimeout(lp.t); lp = null;
  };
  ['touchmove', 'touchend', 'touchcancel'].forEach((ev) => $('#messages').addEventListener(ev, cancelLp, { passive: true }));
  setupComposer();

  vault.addEventListener('change', () => { renderSidebar(); renderMessages(); });
  vault.addEventListener('sync', renderSync);

  const visible = [...vault.chats.values()].filter((c) => !c.deleted);
  if (!vault.chats.has(ui.chat)) ui.chat = visible[0]?.id || null;
  if (isMobile() && !localStorage.getItem('tf.chat') && ui.view !== 'calendar') setSidebar(true);
  if (ui.view === 'calendar') openCalendar(); else openChat(ui.chat);
  renderSync();

  // Always pull (and push anything waiting) when the app opens or comes back to the foreground.
  doSync(false);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      // locked chats lock again as soon as the app goes to the background
      if (ui.unlocked.size) { ui.unlocked.clear(); modalStack.slice().forEach((m) => m.close()); renderSidebar(); renderMessages(); }
      return;
    }
    if (vault.settings.lock && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000) return location.reload();
    if (Date.now() - (vault.settings.lastSync || 0) > 5000) doSync(false);
  });
  addEventListener('online', () => doSync(false));
  setInterval(() => { if (!document.hidden && vault.settings.autoSync) doSync(false); }, 120000);
  setInterval(renderSync, 30000);
}

const isMobile = () => matchMedia('(max-width: 760px)').matches;
function setSidebar(open) { $('.layout')?.classList.toggle('side-open', open); }

async function doSync(manual) {
  if (!navigator.onLine && !manual) return;
  try {
    await vault.sync();
    if (manual) toast('Synced', 'ok');
  } catch (e) {
    console.error(e);
    if (manual) toast(e.message, 'bad');
  }
}

async function renderSync() {
  const btn = $('#syncBtn');
  if (!btn) return;
  const running = !!vault.sync_.running;
  const n = await vault.pendingCount();
  btn.classList.toggle('spin', running);
  btn.classList.toggle('err', !!vault.sync_.error && !running);
  const badge = $('#syncBadge');
  badge.textContent = n ? String(n) : '';
  badge.hidden = !n;
  btn.title = n ? `${n} item(s) waiting to upload – tap to sync` : 'Sync (pull + push)';
  const line = $('#syncLine');
  if (running) line.textContent = vault.sync_.progress || 'Syncing…';
  else if (vault.sync_.error) line.textContent = `⚠ ${vault.sync_.error}`;
  else line.textContent = `Synced ${ago(vault.settings.lastSync)}${n ? ` · ${n} waiting` : ''}`;
  line.classList.toggle('bad', !!vault.sync_.error && !running);
}

function memberIndex(id) {
  const list = [...vault.members.values()].sort((a, b) => a.since - b.since);
  const i = list.findIndex((m) => m.id === id);
  return i < 0 ? 2 : Math.min(i, 2);
}
const nameOf = (id) => vault.members.get(id)?.name || 'Unknown';
const initial = (id) => (nameOf(id).trim()[0] || '?').toUpperCase();

function renderSidebar() {
  const list = $('#chatList');
  if (!list) return;
  const chats = [...vault.chats.values()].sort((a, b) => a.created - b.created);
  const live = chats.filter((c) => !c.deleted), hidden = chats.filter((c) => c.deleted);
  const item = (c) => isLocked(c) ? `
    <button class="chat-item locked ${c.id === ui.chat && ui.view === 'chat' ? 'on' : ''}" data-chat="${esc(c.id)}" title="Locked – tap to unlock">
      <span class="chat-emoji">${icon('lock')}</span><span class="chat-name">Locked chat</span>
    </button>` : `
    <button class="chat-item ${c.id === ui.chat && ui.view === 'chat' ? 'on' : ''} ${c.deleted ? 'hidden-chat' : ''}" data-chat="${esc(c.id)}">
      <span class="chat-emoji">${chatIcon(c)}</span>
      <span class="chat-name">${esc(c.name)}</span>
      ${c.locked ? `<span class="lock-open" title="Unlocked until you leave">${icon('lock')}</span>` : ''}
      ${c.pending ? `<span class="dot" title="Not synced yet"></span>` : `<span class="chat-count">${c.count || ''}</span>`}
    </button>`;
  const todayK = dayKey(new Date()), soonK = dayKey(new Date(Date.now() + 30 * 86400000));
  const upcoming = [...vault.calendar.values()].filter((e) => { if (e.deleted) return false; const n = nextOccurrence(e, todayK); return n >= todayK && n <= soonK; }).length;
  list.innerHTML = `<button class="chat-item cal-item ${ui.view === 'calendar' ? 'on' : ''}" data-cal>
      <span class="chat-emoji">${icon('calendar')}</span><span class="chat-name">Calendar</span><span class="chat-count">${upcoming || ''}</span></button>
    <div class="side-label">Chats</div>` +
    live.map(item).join('') +
    (live.length ? '' : `<p class="muted small pad">No chats yet. Tap + to create one.</p>`) +
    (hidden.length ? `<button class="hidden-toggle small muted" data-toggle-hidden>${icon('archive')} Hidden chats (${hidden.length})</button>${ui.showHidden ? hidden.map(item).join('') : ''}` : '');
  const me = vault.settings.personId;
  $('#meName').textContent = nameOf(me) || vault.settings.name;
  const av = $('#meAvatar');
  av.textContent = initial(me);
  av.className = `avatar p${memberIndex(me)}`;
}

function openChat(id) {
  if (ui.chat !== id) {
    ui.win = 150;
    if (ui.chat) ui.unlocked.delete(ui.chat); // leaving a locked chat locks it again
  }
  ui.chat = id;
  ui.view = 'chat';
  localStorage.setItem('tf.view', 'chat');
  if (id) localStorage.setItem('tf.chat', id);
  renderSidebar();
  renderMessages(true);
  const c = vault.chats.get(id);
  if (c && !isLocked(c) && !isTouch) $('#input').focus();
}

function openCalendar() {
  if (ui.chat) ui.unlocked.delete(ui.chat);
  ui.view = 'calendar';
  localStorage.setItem('tf.view', 'calendar');
  renderSidebar();
  renderMessages(true);
}

function renderMessages(forceBottom = false, keepAnchor = null) {
  const box = $('#messages');
  if (!box) return;
  const c = vault.chats.get(ui.chat);
  const title = $('#chatTitle');
  const calendar = ui.view === 'calendar';
  $('#composer').hidden = calendar || !c || isLocked(c) || c.kind === 'timeline';
  $('#tray').hidden = calendar || !ui.tray.length;
  $('#mediaBtn').hidden = $('#infoBtn').hidden = calendar || !c || isLocked(c);
  if (c?.kind === 'timeline') $('#mediaBtn').hidden = true;
  if (!$('#tray').hidden && c?.kind === 'timeline') $('#tray').hidden = true;
  if (calendar) {
    title.innerHTML = `<span class="chat-emoji">${icon('calendar')}</span><div><div class="t">Calendar</div><div class="d muted">Shared by both of you</div></div>`;
    return renderCalendar(box);
  }
  if (c && isLocked(c)) {
    title.innerHTML = `<span class="chat-emoji">${icon('lock')}</span><div><div class="t">Locked chat</div></div>`;
    box.innerHTML = `<div class="empty"><button class="lock-big" data-act="unlock">${icon('lock')}</button><p>This chat is locked.<br>Tap the lock and enter the PIN.</p></div>`;
    return;
  }
  if (!c) {
    title.innerHTML = '';
    box.innerHTML = `<div class="empty"><div class="logo-mark"></div><p>Create a chat to start your archive.</p><button class="btn primary" data-act="new-chat">${icon('plus')} New chat</button></div>`;
    return;
  }
  title.innerHTML = `<span class="chat-emoji">${chatIcon(c)}</span><div><div class="t">${esc(c.name)}${c.deleted ? ' <span class="pill">hidden</span>' : ''}${c.locked ? ` <span class="pill">${icon('lock')} locked</span>` : ''}</div>${c.desc ? `<div class="d muted">${esc(c.desc)}</div>` : ''}</div>`;
  if (c.kind === 'timeline') return renderTimeline(box, c, forceBottom);
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prevHeight = box.scrollHeight, prevTop = box.scrollTop;
  const all = vault.byChat.get(c.id) || [];
  const start = Math.max(0, all.length - ui.win);
  const list = all.slice(start);
  const me = vault.settings.personId;
  let html = '';
  if (start > 0) html += `<button class="load-older" data-act="older">Show older messages (${start})</button>`;
  else html += `<div class="chat-start"><div class="big-emoji">${c.emoji ? esc(c.emoji) : icon('hash')}</div><h2>${esc(c.name)}</h2><p class="muted">Created by ${esc(nameOf(c.creator))} · ${fmtFull(c.created)}</p></div>`;
  let prev = null;
  for (const m of list) {
    const newDay = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
    if (newDay) html += `<div class="day"><span>${fmtDay(m.ts)}</span></div>`;
    const head = newDay || !prev || prev.author !== m.author || m.ts - prev.ts > 7 * 60000;
    const pi = memberIndex(m.author);
    html += `<div class="msg ${head ? 'head' : ''} ${m.author === me ? 'mine' : ''}" data-id="${esc(m.id)}">
      <div class="gutter">${head ? `<div class="avatar p${pi}">${esc(initial(m.author))}</div>` : `<time class="hover-time">${fmtTime(m.ts)}</time>`}</div>
      <div class="body">
        ${head ? `<div class="meta"><span class="author p${pi}">${esc(nameOf(m.author))}</span><time title="${esc(fmtFull(m.ts))}">${fmtTime(m.ts)}</time></div>` : ''}
        ${m.deleted ? `<div class="text deleted">${icon('trash')} message deleted</div>` : m.text ? `<div class="text">${linkify(esc(m.text))}</div>` : ''}
        ${m.att.length ? renderAtt(m) : ''}
        ${m.edited || m.pending ? `<div class="flags">${m.edited ? `<span title="${esc(fmtFull(m.edited))}">edited</span>` : ''}${m.pending ? `<span class="pend">${icon('clock')} not synced</span>` : ''}</div>` : ''}
      </div>
      ${m.deleted ? '' : `<button class="msg-more" data-act="more" title="More">${icon('more')}</button>`}
    </div>`;
    prev = m;
  }
  box.innerHTML = html;
  if (keepAnchor === 'older') box.scrollTop = box.scrollHeight - prevHeight + prevTop;
  else if (forceBottom || atBottom) box.scrollTop = box.scrollHeight;
  else box.scrollTop = prevTop;
}

function renderAtt(m) {
  const imgs = m.att.filter((a) => a.kind === 'image');
  const files = m.att.filter((a) => a.kind !== 'image');
  let h = '';
  if (imgs.length) {
    h += `<div class="att-grid n${Math.min(imgs.length, 4)}">` + imgs.map((a) => {
      const ratio = a.w && a.h ? Math.max(0.4, Math.min(2.5, a.w / a.h)) : 1;
      const src = SAFE_THUMB.test(a.thumb || '') ? a.thumb : '';
      return `<button class="att-img" data-act="view" data-msg="${esc(m.id)}" data-path="${esc(a.path)}" style="aspect-ratio:${imgs.length === 1 ? ratio : 1}">
        ${src ? `<img src="${src}" alt="${esc(a.name || 'image')}" loading="lazy">` : icon('image')}</button>`;
    }).join('') + '</div>';
  }
  for (const a of files) {
    const isVideo = (a.mime || '').startsWith('video/');
    const isAudio = (a.mime || '').startsWith('audio/');
    h += `<button class="att-file" data-act="${isVideo || isAudio ? 'view' : 'file'}" data-msg="${esc(m.id)}" data-path="${esc(a.path)}">
      <span class="fi">${icon(isVideo ? 'play' : 'file')}</span><span class="fn"><b>${esc(a.name || 'file')}</b><span class="muted small">${fmtSize(a.size || 0)}${a.mime ? ' · ' + esc(a.mime) : ''}</span></span>${icon('download', 'dl')}</button>`;
  }
  return h;
}

function findAtt(msgId, path) {
  const m = vault.messages.get(msgId);
  return m?.att.find((a) => a.path === path);
}

function onMessageClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'older') { ui.win += 200; renderMessages(false, 'older'); }
  else if (act === 'unlock') unlockChat(ui.chat);
  else if (act.startsWith('cal-')) calendarAction(act, t);
  else if (act === 'tl-add') itemDialog(ui.chat, null);
  else if (act === 'tl-open') { if (Date.now() - (ui.tlSuppress || 0) > 60) itemDialog(ui.chat, t.dataset.item); }
  else if (act === 'new-chat') chatDialog();
  else if (act === 'more') messageMenu(t.closest('.msg').dataset.id);
  else if (act === 'view') {
    const a = findAtt(t.dataset.msg, t.dataset.path);
    if (a) viewer(a, ui.chat);
  } else if (act === 'file') {
    const a = findAtt(t.dataset.msg, t.dataset.path);
    if (a) saveAttachment(a);
  }
}

// ---------------- composer ----------------
function setupComposer() {
  const input = $('#input'), form = $('#composer'), fileInput = $('#fileInput');
  const grow = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  input.addEventListener('input', grow);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !isTouch && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  $('#attachBtn').onclick = () => fileInput.click();
  fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ''; };
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  const pane = $('#chatPane');
  pane.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); pane.classList.add('drop'); } });
  pane.addEventListener('dragleave', (e) => { if (e.target === pane || !pane.contains(e.relatedTarget)) pane.classList.remove('drop'); });
  pane.addEventListener('drop', (e) => { e.preventDefault(); pane.classList.remove('drop'); addFiles([...(e.dataTransfer?.files || [])]); });
  $('#tray').onclick = (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { ui.tray.splice(+b.dataset.rm, 1); renderTray(); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (ui.busy || !ui.chat) return;
    const text = input.value.trim();
    const items = ui.tray.filter((t) => t.ready);
    if (ui.tray.some((t) => !t.ready && !t.error)) return toast('Still preparing attachments…');
    if (!text && !items.length) return;
    ui.busy = true;
    $('#sendBtn').disabled = true;
    try {
      const att = [];
      for (const it of items) {
        const path = await vault.addBlob(it.bytes);
        att.push({ kind: it.kind, path, name: it.name, mime: it.mime, size: it.bytes.length, w: it.w, h: it.h, thumb: it.thumb });
      }
      await vault.sendMessage(ui.chat, text, att);
      input.value = ''; grow();
      ui.tray = []; renderTray();
      renderMessages(true);
    } catch (err) { console.error(err); toast(err.message, 'bad'); }
    finally { ui.busy = false; $('#sendBtn').disabled = false; }
  };
}

const MAX_FILE = 50 * 1024 * 1024;
function addFiles(files) {
  if (!ui.chat) return;
  for (const f of files) {
    if (f.size > MAX_FILE) { toast(`${f.name} is larger than 50 MB`, 'bad'); continue; }
    const item = { name: f.name, ready: false, preview: null };
    ui.tray.push(item);
    processFile(f, vault.settings.compress !== false).then((r) => { Object.assign(item, r, { ready: true }); renderTray(); })
      .catch((e) => { item.error = e.message; renderTray(); });
  }
  renderTray();
}

function renderTray() {
  const tray = $('#tray');
  tray.hidden = !ui.tray.length;
  tray.innerHTML = ui.tray.map((t, i) => `
    <div class="tray-item ${t.error ? 'bad' : ''}">
      ${t.thumb && SAFE_THUMB.test(t.thumb) ? `<img src="${t.thumb}" alt="">` : `<div class="tray-file">${icon('file')}<span>${esc(t.name)}</span></div>`}
      ${!t.ready && !t.error ? '<div class="tray-busy"></div>' : ''}
      ${t.ready && t.bytes ? `<span class="tray-size">${fmtSize(t.bytes.length)}</span>` : ''}
      <button type="button" class="tray-rm" data-rm="${i}" title="Remove">${icon('x')}</button>
    </div>`).join('');
}

// ---------------- message actions ----------------
function messageMenu(id) {
  const m = vault.messages.get(id);
  if (!m || m.deleted) return;
  const mine = m.author === vault.settings.personId;
  const mm = modal(`
    <div class="sheet-head"><b>${esc(nameOf(m.author))}</b><span class="muted small">${fmtFull(m.ts)}${m.edited ? ` · edited ${fmtFull(m.edited)}` : ''}</span></div>
    <div class="menu">
      ${m.text ? `<button data-a="copy">${icon('copy')} Copy text</button>` : ''}
      ${mine ? `<button data-a="edit">${icon('edit')} Edit</button><button data-a="del" class="danger-text">${icon('trash')} Delete</button>` : `<p class="muted small pad">Only ${esc(nameOf(m.author))} can edit or delete this message.</p>`}
    </div>`, { cls: 'sheet' });
  mm.el.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    mm.close();
    if (a === 'copy') { await navigator.clipboard?.writeText(m.text).catch(() => {}); toast('Copied'); }
    if (a === 'edit') editDialog(m);
    if (a === 'del' && await confirmBox('Delete message?', 'It will disappear for both of you. (Old encrypted copies remain in the repo history.)', 'Delete', true)) {
      try { await vault.deleteMessage(m.id); } catch (err) { toast(err.message, 'bad'); }
    }
  };
}

function editDialog(m) {
  const d = modal(`<h2>Edit message</h2><textarea id="e-text" rows="6" autofocus>${esc(m.text)}</textarea>
    <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="e-save">Save</button></div>`);
  $('#e-save', d.el).onclick = async () => {
    const t = $('#e-text', d.el).value.trim();
    if (t === m.text) return d.close();
    if (!t && !m.att.length) return toast('Message can’t be empty – delete it instead', 'bad');
    try { await vault.editMessage(m.id, t); d.close(); } catch (e) { toast(e.message, 'bad'); }
  };
}

// ---------------- chat dialogs ----------------
function chatDialog(id) {
  const c = id ? vault.chats.get(id) : null;
  if (c && isLocked(c)) return;
  const d = modal(`
    <h2>${c ? (c.kind === 'timeline' ? 'Timeline settings' : 'Chat settings') : 'New channel'}</h2>
    ${c ? `<p class="muted small">Created by <b>${esc(nameOf(c.creator))}</b> on ${fmtFull(c.created)} · ${c.count} ${c.kind === 'timeline' ? 'events' : 'messages'}</p>` : `
    <div class="kind-pick">
      <label><input type="radio" name="c-kind" value="chat" checked><span>${icon('hash')}<b>Chat</b><small>Messages, photos and files</small></span></label>
      <label><input type="radio" name="c-kind" value="timeline"><span>${icon('timeline')}<b>Timeline</b><small>Events on one long line</small></span></label>
    </div>`}
    <div class="row"><label class="emoji-l">Icon<input id="c-emoji" maxlength="8" value="${esc(c?.emoji || '')}" placeholder="📁"></label>
    <label class="grow">Name<input id="c-name" maxlength="60" value="${esc(c?.name || '')}" placeholder="e.g. trips" autofocus></label></div>
    <label>Description<textarea id="c-desc" rows="2" maxlength="500">${esc(c?.desc || '')}</textarea></label>
    <label class="check"><input type="checkbox" id="c-lock" ${c?.locked ? 'checked' : ''}> ${icon('lock')} Lock this chat with the shared PIN</label>
    <p class="muted small">Both of you can post here and change these settings. If you both change the same thing, the version synced last wins.</p>
    <div class="row end">
      ${c ? `<button class="btn ghost danger-text" id="c-hide">${c.deleted ? 'Unhide chat' : 'Hide chat'}</button><span class="grow"></span>` : ''}
      <button class="btn ghost" data-close>Cancel</button>
      <button class="btn primary" id="c-save">${c ? 'Save' : 'Create'}</button>
    </div>`);
  $('#c-save', d.el).onclick = async () => {
    const name = $('#c-name', d.el).value.trim(), emoji = $('#c-emoji', d.el).value.trim(), desc = $('#c-desc', d.el).value.trim();
    const locked = $('#c-lock', d.el).checked;
    if (!name) return toast('Give the chat a name', 'bad');
    if (locked && !c?.locked) {
      if (!vault.pin) { if (!(await setPinFlow('Choose the PIN for locked chats', 'You only set this once. It is shared by both of you and unlocks every locked chat.'))) return; }
      else if (!(await pinPad({ title: 'Enter the PIN to lock', check: (p) => vault.checkPin(p) }))) return;
    }
    try {
      let cid = c?.id;
      if (locked && c) ui.unlocked.add(c.id); // you stay inside the chat until you leave it
      if (c) {
        const f = {};
        if (name !== c.name) f.name = name;
        if (emoji !== c.emoji) f.emoji = emoji;
        if (desc !== c.desc) f.desc = desc;
        if (locked !== !!c.locked) f.locked = locked;
        if (Object.keys(f).length) await vault.updateChat(c.id, f);
      } else {
        cid = await vault.createChat({ name, emoji, desc, kind: d.el.querySelector('[name="c-kind"]:checked')?.value || 'chat' });
        if (locked) { ui.unlocked.add(cid); await vault.updateChat(cid, { locked: true }); }
      }
      renderSidebar(); renderMessages();
      if (!c) { openChat(cid); setSidebar(false); }
      d.close();
      if (locked && !c?.locked) toast('Locked. It locks again when you leave the chat or close the app.');
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#c-hide', d.el)?.addEventListener('click', async () => {
    if (!c.deleted && !(await confirmBox('Hide chat?', 'It moves to “Hidden chats” for both of you. Nothing is deleted and either of you can unhide it.', 'Hide'))) return;
    await vault.updateChat(c.id, { deleted: !c.deleted });
    d.close();
  });
}

// ---------------- PIN keypad + locked chats ----------------
// Resolves with the 4-digit PIN, or null if cancelled. If `check` is given, wrong PINs shake and retry.
function pinPad({ title, subtitle = '', check }) {
  return new Promise((resolve) => {
    let pin = '', fails = 0, done = false, busy = false;
    const d = modal(`
      <div class="pinpad">
        <div class="pin-lock">${icon('lock')}</div>
        <h2>${esc(title)}</h2>${subtitle ? `<p class="muted small">${esc(subtitle)}</p>` : ''}
        <div class="pin-dots">${'<span></span>'.repeat(4)}</div>
        <p class="pin-msg bad small"></p>
        <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
          <button data-close class="k-text">Cancel</button><button data-k="0">0</button><button data-k="del" title="Delete">${icon('backspace')}</button></div>
      </div>`, { cls: 'pin-wrap', onClose: () => { document.removeEventListener('keydown', onKey); if (!done) resolve(null); } });
    const dots = $$('.pin-dots span', d.el), msg = $('.pin-msg', d.el);
    const draw = () => dots.forEach((s, i) => s.classList.toggle('on', i < pin.length));
    const press = async (k) => {
      if (busy) return;
      if (k === 'del') pin = pin.slice(0, -1);
      else if (pin.length < 4) pin += k;
      draw();
      if (pin.length < 4) return;
      if (!check) { done = true; d.close(); return resolve(pin); }
      busy = true;
      const ok = await check(pin);
      busy = false;
      if (ok) { done = true; d.close(); return resolve(pin); }
      fails++;
      const box = $('.pin-dots', d.el);
      box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      msg.textContent = fails >= 5 ? 'Wrong PIN – wait a moment' : 'Wrong PIN';
      pin = '';
      setTimeout(draw, 250);
      if (fails >= 5) { busy = true; setTimeout(() => { busy = false; msg.textContent = ''; }, 3000 * (fails - 4)); }
    };
    d.el.addEventListener('click', (e) => { const k = e.target.closest('[data-k]')?.dataset.k; if (k) press(k); });
    const onKey = (e) => { if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('del'); };
    document.addEventListener('keydown', onKey);
  });
}

async function setPinFlow(title, subtitle) {
  const a = await pinPad({ title, subtitle });
  if (!a) return false;
  const b = await pinPad({ title: 'Repeat the PIN', check: async (p) => p === a });
  if (!b) return false;
  await vault.setPin(a);
  toast('PIN saved – it syncs to the other device', 'ok');
  return true;
}

async function unlockChat(id) {
  if (vault.pin && !(await pinPad({ title: 'Locked chat', subtitle: 'Enter the shared PIN', check: (p) => vault.checkPin(p) }))) return;
  ui.unlocked.add(id);
  openChat(id); // openChat re-locks the chat you came from, never this one
  setSidebar(false);
}

// ---------------- calendar ----------------
const pad2 = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDay = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
// Does calendar event `e` happen on day `k`? Yearly events repeat on the same date from their first year on
// (a Feb 29 event shows on Feb 28 in non-leap years).
function occursOn(e, k) {
  if (!e.yearly) return e.day === k;
  if (k < e.day) return false;
  const md = e.day.slice(5), kmd = k.slice(5);
  return md === kmd || (md === '02-29' && kmd === '02-28' && !isLeap(+k.slice(0, 4)));
}
function nextOccurrence(e, fromK) {
  if (!e.yearly || e.day >= fromK) return e.day;
  for (let y = +fromK.slice(0, 4); ; y++) {
    const md = e.day.slice(5) === '02-29' && !isLeap(y) ? '02-28' : e.day.slice(5);
    if (`${y}-${md}` >= fromK) return `${y}-${md}`;
  }
}
const eventsOn = (k) => [...vault.calendar.values()].filter((e) => !e.deleted && occursOn(e, k)).sort((a, b) => a.created - b.created);
const fmtDayLong = (k) => parseDay(k).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function renderCalendar(box) {
  const todayK = dayKey(new Date());
  if (!ui.calDay) ui.calDay = todayK;
  if (!ui.calMonth) ui.calMonth = ui.calDay.slice(0, 7);
  // keep whatever is being typed if a sync re-renders the view
  const typing = $('#cal-title', box);
  const draft = typing?.value || '', hadFocus = typing && document.activeElement === typing;
  const yearlyDraft = $('#cal-yearly', box)?.checked || false;
  const [y, m] = ui.calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const dows = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString([], { weekday: 'short' }));
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(y, m - 1, 1 - offset + i);
    const k = dayKey(d), evs = eventsOn(k);
    cells += `<button class="cal-cell ${d.getMonth() !== m - 1 ? 'other' : ''} ${k === todayK ? 'today' : ''} ${k === ui.calDay ? 'sel' : ''}" data-act="cal-day" data-day="${k}">
      <span class="n">${d.getDate()}</span>
      <span class="chips">${evs.slice(0, 3).map((e) => `<span class="chip p${memberIndex(e.author)}">${e.yearly ? '↻ ' : ''}${esc(e.title)}</span>`).join('')}${evs.length > 3 ? `<span class="more">+${evs.length - 3}</span>` : ''}</span>
    </button>`;
    if (i === 34 && new Date(y, m - 1, 1 - offset + 35).getMonth() !== m - 1) break; // 5 weeks are enough
  }
  const dayEvents = eventsOn(ui.calDay);
  const upcoming = [...vault.calendar.values()].filter((e) => !e.deleted).map((e) => ({ e, on: nextOccurrence(e, todayK) }))
    .filter((x) => x.on >= todayK).sort((a, b) => a.on.localeCompare(b.on) || a.e.created - b.e.created).slice(0, 12);
  const evRow = (e, on, showDay) => {
    const years = e.yearly ? +on.slice(0, 4) - +e.day.slice(0, 4) : 0;
    const bits = [];
    if (showDay) bits.push(esc(parseDay(on).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })));
    if (e.yearly) bits.push(`<span class="yearly-tag">${icon('repeat')} every year${years > 0 ? ` · ${years} ${years === 1 ? 'year' : 'years'} since ${e.day.slice(0, 4)}` : ''}</span>`);
    bits.push(`added by ${esc(nameOf(e.author))}`);
    if (e.pending) bits.push('not synced');
    return `<button class="cal-ev" data-act="cal-edit" data-ev="${esc(e.id)}">
      <span class="bar p${memberIndex(e.author)}"></span>
      <span class="grow"><b>${esc(e.title)}</b><span class="muted small">${bits.join(' · ')}</span></span>
      ${icon('edit', 'muted')}</button>`;
  };
  box.innerHTML = `
  <div class="cal">
    <div class="cal-head">
      <button class="icon-btn" data-act="cal-prev" title="Previous month">${icon('left')}</button>
      <h2 class="grow">${first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2>
      <button class="btn ghost" data-act="cal-today">Today</button>
      <button class="icon-btn" data-act="cal-next" title="Next month">${icon('right')}</button>
    </div>
    <div class="cal-grid">${dows.map((w) => `<div class="dow">${esc(w)}</div>`).join('')}${cells}</div>
    <div class="cal-side">
      <section class="cal-day">
        <h3>${esc(fmtDayLong(ui.calDay))}</h3>
        ${dayEvents.map((e) => evRow(e, ui.calDay, false)).join('') || '<p class="muted small">Nothing on this day.</p>'}
        <div class="cal-add"><input id="cal-title" maxlength="200" placeholder="Add an event on this day…" enterkeyhint="done"><button class="btn primary" data-act="cal-add">${icon('plus')} Add</button></div>
        <label class="check yearly-check"><input type="checkbox" id="cal-yearly"> ${icon('repeat')} Repeats every year (birthdays, anniversaries…)</label>
      </section>
      <section><h3>Upcoming</h3>${upcoming.map((x) => evRow(x.e, x.on, true)).join('') || '<p class="muted small">No upcoming events.</p>'}</section>
    </div>
  </div>`;
  const input = $('#cal-title', box);
  input.value = draft;
  $('#cal-yearly', box).checked = yearlyDraft;
  if (hadFocus) input.focus();
  input.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); calendarAction('cal-add'); } };
}

async function calendarAction(act, t) {
  const [y, m] = (ui.calMonth || dayKey(new Date()).slice(0, 7)).split('-').map(Number);
  if (act === 'cal-prev' || act === 'cal-next') {
    const d = new Date(y, m - 1 + (act === 'cal-next' ? 1 : -1), 1);
    ui.calMonth = dayKey(d).slice(0, 7);
  } else if (act === 'cal-today') {
    ui.calDay = dayKey(new Date()); ui.calMonth = ui.calDay.slice(0, 7);
  } else if (act === 'cal-day') {
    ui.calDay = t.dataset.day; ui.calMonth = ui.calDay.slice(0, 7);
  } else if (act === 'cal-add') {
    const input = $('#cal-title');
    const title = input.value.trim();
    if (!title) return input.focus();
    const yearly = $('#cal-yearly')?.checked;
    input.value = '';
    await vault.addEvent(ui.calDay, title, yearly);
    return;
  } else if (act === 'cal-edit') {
    return eventDialog(t.dataset.ev);
  }
  renderMessages();
}

function eventDialog(id) {
  const e = vault.calendar.get(id);
  if (!e) return;
  const d = modal(`
    <h2>Edit event</h2>
    <p class="muted small">Added by ${esc(nameOf(e.author))}${e.editedBy ? ` · last edited by ${esc(nameOf(e.editedBy))}` : ''}</p>
    <label>Title<input id="ev-title" maxlength="200" value="${esc(e.title)}" autofocus></label>
    <label>${e.yearly ? 'Date (first year)' : 'Day'}<input id="ev-day" type="date" value="${esc(e.day)}"></label>
    <label class="check"><input type="checkbox" id="ev-yearly" ${e.yearly ? 'checked' : ''}> ${icon('repeat')} Repeats every year</label>
    <div class="row end"><button class="btn ghost danger-text" id="ev-del">${icon('trash')} Delete</button><span class="grow"></span>
      <button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ev-save">Save</button></div>`);
  $('#ev-save', d.el).onclick = async () => {
    const title = $('#ev-title', d.el).value.trim(), day = $('#ev-day', d.el).value;
    if (!title || !day) return toast('Title and day are needed', 'bad');
    const f = {};
    if (title !== e.title) f.title = title;
    if (day !== e.day) f.day = day;
    const yearly = $('#ev-yearly', d.el).checked;
    if (yearly !== !!e.yearly) f.yearly = yearly;
    if (Object.keys(f).length) await vault.editEvent(id, f);
    if (f.day) { ui.calDay = day; ui.calMonth = day.slice(0, 7); renderMessages(); }
    d.close();
  };
  $('#ev-del', d.el).onclick = async () => {
    if (!(await confirmBox('Delete event?', `“${e.title}” will be removed for both of you.`, 'Delete', true))) return;
    await vault.deleteEvent(id); d.close();
  };
}

function mediaDialog(chatId) {
  const items = [];
  for (const m of vault.byChat.get(chatId) || []) for (const a of m.att) if (a.kind === 'image' || (a.mime || '').startsWith('video/')) items.push({ m, a });
  items.reverse();
  const d = modal(`<div class="row"><h2 class="grow">Media</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    ${items.length ? `<div class="media-grid">${items.map(({ m, a }, i) => `<button data-i="${i}" title="${esc(fmtFull(m.ts))}">${SAFE_THUMB.test(a.thumb || '') ? `<img src="${a.thumb}" loading="lazy" alt="">` : icon('play')}</button>`).join('')}</div>` : '<p class="muted">No images in this chat yet.</p>'}`, { cls: 'wide' });
  d.el.onclick = (e) => {
    const b = e.target.closest('[data-i]');
    if (b) viewer(items[+b.dataset.i].a, chatId);
  };
}

// ---------------- viewer ----------------
function viewer(att, chatId) {
  const all = [];
  for (const m of vault.byChat.get(chatId) || []) for (const a of m.att) if (a.kind === 'image' || /^(video|audio)\//.test(a.mime || '')) all.push({ a, m });
  let idx = Math.max(0, all.findIndex((x) => x.a.path === att.path));
  const d = modal(`
    <div class="viewer-bar"><div class="viewer-meta"></div>
      <button class="icon-btn" id="v-save" title="Save">${icon(navigator.canShare ? 'share' : 'download')}</button>
      <button class="icon-btn" data-close title="Close">${icon('x')}</button></div>
    <div class="viewer-stage"><button class="v-nav prev" title="Previous">${icon('left')}</button><div class="v-content"></div><button class="v-nav next" title="Next">${icon('right')}</button></div>`, { cls: 'viewer' });
  const show = async () => {
    const { a, m } = all[idx] || { a: att, m: null };
    $('.viewer-meta', d.el).innerHTML = m ? `<b>${esc(nameOf(m.author))}</b> <span class="muted">${fmtFull(m.ts)}</span>` : '';
    $('.prev', d.el).hidden = idx <= 0;
    $('.next', d.el).hidden = idx >= all.length - 1;
    const box = $('.v-content', d.el);
    box.innerHTML = SAFE_THUMB.test(a.thumb || '') ? `<img class="v-thumb" src="${a.thumb}" alt=""><div class="spinner"></div>` : '<div class="spinner"></div>';
    try {
      const url = await vault.blobURL(a.path, a.mime);
      if (all[idx] && all[idx].a !== a) return;
      if ((a.mime || '').startsWith('video/')) box.innerHTML = `<video src="${url}" controls playsinline autoplay></video>`;
      else if ((a.mime || '').startsWith('audio/')) box.innerHTML = `<audio src="${url}" controls autoplay></audio>`;
      else box.innerHTML = `<img src="${url}" alt="${esc(a.name || '')}">`;
    } catch (e) { box.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  };
  $('.prev', d.el).onclick = () => { if (idx > 0) { idx--; show(); } };
  $('.next', d.el).onclick = () => { if (idx < all.length - 1) { idx++; show(); } };
  $('#v-save', d.el).onclick = () => saveAttachment((all[idx] || { a: att }).a);
  const keys = (e) => { if (e.key === 'ArrowLeft') $('.prev', d.el).click(); if (e.key === 'ArrowRight') $('.next', d.el).click(); };
  document.addEventListener('keydown', keys);
  let sx = null;
  d.el.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  d.el.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx; sx = null;
    if (Math.abs(dx) > 60) (dx > 0 ? $('.prev', d.el) : $('.next', d.el)).click();
  });
  const obs = new MutationObserver(() => { if (!d.el.isConnected) { document.removeEventListener('keydown', keys); obs.disconnect(); } });
  obs.observe($('#modal-root'), { childList: true });
  show();
}

async function saveAttachment(a) {
  try {
    toast('Preparing file…');
    const bytes = await vault.getBlob(a.path);
    const file = new File([bytes], a.name || 'file', { type: a.mime || 'application/octet-stream' });
    if (isTouch && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] }).catch(() => {});
    } else {
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (e) { toast(e.message, 'bad'); }
}

// ---------------- timeline ----------------
const TL_COLORS = {
  blue: '#8aa4ff', peach: '#f2a97e', green: '#8fd19e', purple: '#b79cff', pink: '#f59ac0',
  yellow: '#f3d26b', teal: '#6fd3d0', red: '#ff8a8a', gray: '#aab2c0',
};
const tlColor = (k) => (TL_COLORS[k] ? k : 'blue');

function renderTimeline(box, c, toEnd) {
  if (ui.tlDragging) { ui.tlRedraw = true; return; } // don't yank the line away mid-drag
  const items = vault.byTimeline.get(c.id) || [];
  const old = $('.tl-wrap', box);
  const prevLeft = old?.scrollLeft ?? 0;
  const atEnd = !old || old.scrollLeft + old.clientWidth >= old.scrollWidth - 40;
  const slots = items.map((it, i) => `
    <div class="tl-slot ${i % 2 ? 'down' : 'up'}" data-slot="${esc(it.id)}">
      <button class="tl-box c-${tlColor(it.color)}" data-act="tl-open" data-item="${esc(it.id)}" title="${esc(it.title)}">
        <span>${esc(it.title)}</span>${it.pending ? `<i class="tl-pend" title="Not synced yet"></i>` : ''}</button>
      <span class="tl-stem c-${tlColor(it.color)}"></span>
      <span class="tl-dot c-${tlColor(it.color)}"></span>
      <span class="tl-date">${esc(new Date(it.created).toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' }))}</span>
    </div>`).join('');
  box.innerHTML = `
    <div class="tl-wrap">
      <div class="tl-track">
        <div class="tl-line"></div>
        <div class="tl-start"><span class="tl-dot start"></span><span class="tl-date">start</span></div>
        ${slots}
        <div class="tl-end"><button class="tl-add" data-act="tl-add" title="Add event">${icon('plus')}</button></div>
      </div>
      ${items.length ? '' : '<p class="tl-empty muted">Empty timeline – tap + to add the first event.</p>'}
    </div>
    ${items.length > 1 ? `<p class="tl-hint muted small">${icon('grip')} ${isTouch ? 'Press and hold' : 'Drag'} an event to move it</p>` : ''}
    <button class="tl-fab" data-act="tl-add" title="Add event">${icon('plus')}</button>`;
  const wrap = $('.tl-wrap', box);
  wrap.scrollLeft = toEnd || atEnd ? wrap.scrollWidth : prevLeft;
  // mouse wheel scrolls sideways; drag with the mouse to pan
  wrap.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { wrap.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  // ---- panning (mouse drag on empty space) and rearranging (drag a box; on touch press-and-hold first) ----
  const track = $('.tl-track', wrap);
  let pan = null, mv = null, raf = 0;
  const others = () => [...track.querySelectorAll('.tl-slot:not(.moving)')];
  const targetIndex = (x) => others().filter((sl) => { const r = sl.getBoundingClientRect(); return r.left + r.width / 2 < x; }).length;
  const placeMarker = (idx) => {
    const list = others();
    const left = idx < list.length ? list[idx].offsetLeft : list.length ? list[list.length - 1].offsetLeft + list[list.length - 1].offsetWidth : 70;
    mv.marker.style.left = `${left}px`;
  };
  const startMove = () => {
    if (!mv || mv.active) return;
    mv.active = true; ui.tlDragging = true;
    navigator.vibrate?.(15);
    try { wrap.setPointerCapture(mv.pid); } catch {}
    const r = mv.box.getBoundingClientRect();
    mv.offX = mv.x - r.left;
    mv.ghost = mv.box.cloneNode(true);
    mv.ghost.classList.add('tl-ghost');
    Object.assign(mv.ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left}px`, top: `${r.top}px` });
    document.body.append(mv.ghost);
    mv.box.closest('.tl-slot').classList.add('moving');
    mv.marker = document.createElement('div');
    mv.marker.className = 'tl-marker';
    track.append(mv.marker);
    wrap.classList.add('arranging');
    mv.lastX = mv.x;
    placeMarker(targetIndex(mv.x));
    const tick = () => { // auto-scroll near the edges
      if (!mv?.active) return;
      const wr = wrap.getBoundingClientRect();
      const edge = Math.min(70, wr.width * 0.12);
      if (mv.lastX < wr.left + edge) wrap.scrollLeft -= Math.ceil((wr.left + edge - mv.lastX) / 5);
      else if (mv.lastX > wr.right - edge) wrap.scrollLeft += Math.ceil((mv.lastX - (wr.right - edge)) / 5);
      placeMarker(targetIndex(mv.lastX));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  };
  const finish = async (commit) => {
    if (!mv) return;
    const m = mv; mv = null;
    clearTimeout(m.timer);
    if (!m.active) return;
    cancelAnimationFrame(raf);
    const to = targetIndex(m.lastX);
    m.ghost.remove(); m.marker.remove();
    m.box.closest('.tl-slot')?.classList.remove('moving');
    wrap.classList.remove('arranging');
    ui.tlDragging = false;
    ui.tlSuppress = Date.now(); // the drop shouldn't also open the event
    const from = items.findIndex((x) => x.id === m.id);
    if (commit && to !== from) await vault.moveItem(m.id, to);
    else if (ui.tlRedraw) { ui.tlRedraw = false; renderMessages(); }
  };
  wrap.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.tl-box');
    if (b) {
      if (e.button > 0) return;
      mv = { id: b.dataset.item, box: b, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false, touch: e.pointerType !== 'mouse' };
      if (mv.touch) mv.timer = setTimeout(startMove, 380);
      return;
    }
    if (e.pointerType !== 'mouse' || e.target.closest('button')) return;
    pan = { x: e.clientX, left: wrap.scrollLeft };
    wrap.setPointerCapture(e.pointerId); wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', (e) => {
    if (pan) { wrap.scrollLeft = pan.left - (e.clientX - pan.x); return; }
    if (!mv) return;
    const dist = Math.hypot(e.clientX - mv.x, e.clientY - mv.y);
    if (!mv.active) {
      if (mv.touch && dist > 8) { clearTimeout(mv.timer); mv = null; } // it's a scroll, not a hold
      else if (!mv.touch && dist > 6) startMove();
      if (!mv?.active) return;
    }
    mv.lastX = e.clientX;
    mv.ghost.style.left = `${e.clientX - mv.offX}px`;
  });
  wrap.addEventListener('pointerup', () => { pan = null; wrap.classList.remove('dragging'); finish(true); });
  wrap.addEventListener('pointercancel', () => { pan = null; wrap.classList.remove('dragging'); finish(false); });
  // once a box is picked up on a touch screen, stop the finger from scrolling the page instead
  wrap.addEventListener('touchmove', (e) => { if (mv?.active) e.preventDefault(); }, { passive: false });
  wrap.addEventListener('contextmenu', (e) => { if (e.target.closest('.tl-box')) e.preventDefault(); });
}

function itemDialog(chatId, id) {
  const it = id ? vault.items.get(id) : null;
  if (id && !it) return;
  let color = it ? tlColor(it.color) : tlColor(localStorage.getItem('tf.tlColor'));
  const d = modal(`
    <div class="row"><h2 class="grow">${it ? 'Event' : 'New event'}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    ${it ? `<p class="muted small">Added by ${esc(nameOf(it.author))} · ${fmtFull(it.created)}${it.editedBy ? ` · edited by ${esc(nameOf(it.editedBy))}` : ''}</p>` : ''}
    <label>Title<input id="it-title" class="it-title" maxlength="120" value="${esc(it?.title || '')}" placeholder="What happened?" ${it ? '' : 'autofocus'}></label>
    <div class="swatches" role="radiogroup" aria-label="Colour">${Object.keys(TL_COLORS).map((k) => `<button type="button" class="sw c-${k} ${k === color ? 'on' : ''}" data-color="${k}" title="${k}"></button>`).join('')}</div>
    ${it ? `<div class="move-row"><span class="muted small" id="it-pos"></span><span class="grow"></span>
      <button type="button" class="btn ghost" id="it-left">${icon('left')} Earlier</button><button type="button" class="btn ghost" id="it-right">Later ${icon('right')}</button></div>` : ''}
    <label>Description<textarea id="it-desc" rows="8" maxlength="10000" placeholder="Details, memories, notes…">${esc(it?.desc || '')}</textarea></label>
    <div class="row end">
      ${it ? `<button class="btn ghost danger-text" id="it-del">${icon('trash')} Delete</button><span class="grow"></span>` : ''}
      <button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="it-save">${it ? 'Save' : 'Add to timeline'}</button>
    </div>`, { cls: 'wide' });
  if (it) {
    const list = () => vault.byTimeline.get(it.chat) || [];
    const showPos = () => {
      const i = list().findIndex((x) => x.id === it.id), n = list().length;
      $('#it-pos', d.el).textContent = `Position ${i + 1} of ${n}`;
      $('#it-left', d.el).disabled = i <= 0;
      $('#it-right', d.el).disabled = i >= n - 1;
    };
    let queue = Promise.resolve(); // rapid taps run one after another
    const nudge = (delta) => { queue = queue.then(() => step(delta)); };
    const step = async (delta) => {
      const i = list().findIndex((x) => x.id === it.id);
      if (i + delta < 0 || i + delta >= list().length) return;
      await vault.moveItem(it.id, i + delta);
      showPos();
      $(`.tl-slot[data-slot="${CSS.escape(it.id)}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    };
    $('#it-left', d.el).onclick = () => nudge(-1);
    $('#it-right', d.el).onclick = () => nudge(1);
    showPos();
  }
  $('.swatches', d.el).onclick = (e) => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    color = b.dataset.color;
    $$('.sw', d.el).forEach((x) => x.classList.toggle('on', x === b));
  };
  $('#it-save', d.el).onclick = async () => {
    const title = $('#it-title', d.el).value.trim(), desc = $('#it-desc', d.el).value.trim();
    if (!title) { toast('Give the event a title', 'bad'); return $('#it-title', d.el).focus(); }
    try {
      if (it) {
        const f = {};
        if (title !== it.title) f.title = title;
        if (desc !== it.desc) f.desc = desc;
        if (color !== tlColor(it.color)) f.color = color;
        if (Object.keys(f).length) await vault.editItem(it.id, f);
      } else {
        localStorage.setItem('tf.tlColor', color);
        await vault.addItem(chatId, { title, desc, color });
        const w = $('.tl-wrap');
        if (w) w.scrollTo({ left: w.scrollWidth, behavior: 'smooth' });
      }
      d.close();
    } catch (e) { toast(e.message, 'bad'); }
  };
  $('#it-del', d.el)?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete event?', `“${it.title}” will be removed from the timeline for both of you.`, 'Delete', true))) return;
    await vault.deleteItem(it.id); d.close();
  });
}

function jumpToItem(id) {
  const it = vault.items.get(id);
  if (!it) return;
  openChat(it.chat);
  setSidebar(false);
  const el = $(`.tl-slot[data-slot="${CSS.escape(id)}"]`);
  if (el) {
    el.scrollIntoView({ inline: 'center', block: 'nearest' });
    const b = $('.tl-box', el);
    b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 2000);
  }
}

// ---------------- search ----------------
function searchDialog() {
  const lockedCount = [...vault.chats.values()].filter(isLocked).length;
  const d = modal(`<div class="search-box">${icon('search')}<input id="q" placeholder="Search everything…" autofocus autocomplete="off"></div><div class="results" id="results"><p class="muted small pad">Search messages and file names across every chat${lockedCount ? ' (locked chats are skipped)' : ''}.</p></div>`, { cls: 'top' });
  const q = $('#q', d.el), out = $('#results', d.el);
  let t;
  q.oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
  function run() {
    const term = q.value.trim().toLowerCase();
    if (term.length < 2) { out.innerHTML = '<p class="muted small pad">Type at least 2 characters.</p>'; return; }
    const hits = [];
    for (const m of vault.messages.values()) {
      const mc = vault.chats.get(m.chat);
      if (m.deleted || isLocked(mc) || (mc?.deleted && !ui.showHidden)) continue;
      const hay = (m.text + ' ' + m.att.map((a) => a.name).join(' ')).toLowerCase();
      if (hay.includes(term)) hits.push(m);
    }
    for (const it of vault.items.values()) {
      const ic = vault.chats.get(it.chat);
      if (it.deleted || isLocked(ic) || (ic?.deleted && !ui.showHidden)) continue;
      const text = it.desc ? `${it.title} — ${it.desc}` : it.title;
      if (text.toLowerCase().includes(term)) hits.push({ id: it.id, chat: it.chat, author: it.author, ts: it.created, text, att: [], item: true });
    }
    hits.sort((a, b) => b.ts - a.ts);
    if (!hits.length) { out.innerHTML = '<p class="muted small pad">Nothing found.</p>'; return; }
    out.innerHTML = hits.slice(0, 150).map((m) => {
      const c = vault.chats.get(m.chat);
      let snip = m.text || m.att.map((a) => a.name).join(', ');
      const i = snip.toLowerCase().indexOf(term);
      const from = Math.max(0, i - 40);
      snip = (from ? '…' : '') + snip.slice(from, from + 160);
      const hi = esc(snip).replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[&<>"']/g, (ch) => esc(ch)), 'gi'), (x) => `<mark>${x}</mark>`);
      return `<button class="result" ${m.item ? 'data-item' : 'data-msg'}="${esc(m.id)}"><div class="small muted">${c?.emoji ? esc(c.emoji) : '#'} ${esc(c?.name)} · ${esc(nameOf(m.author))} · ${fmtFull(m.ts)}</div><div>${hi}</div></button>`;
    }).join('') + (hits.length > 150 ? `<p class="muted small pad">${hits.length - 150} more – refine your search.</p>` : '');
  }
  out.onclick = (e) => {
    const r = e.target.closest('[data-msg], [data-item]');
    if (!r) return;
    d.close();
    if (r.dataset.item) jumpToItem(r.dataset.item); else jumpTo(r.dataset.msg);
  };
}

function jumpTo(msgId) {
  const m = vault.messages.get(msgId);
  if (!m) return;
  openChat(m.chat);
  setSidebar(false);
  const list = vault.byChat.get(m.chat);
  const pos = list.indexOf(m);
  const need = list.length - pos + 20;
  if (need > ui.win) { ui.win = need; renderMessages(); }
  const el = $(`.msg[data-id="${CSS.escape(msgId)}"]`);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2000); }
}

// ---------------- settings ----------------
async function settingsDialog() {
  const s = vault.settings;
  const n = await vault.pendingCount();
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `${fmtSize(e.usage || 0)} used on this device`; } catch {}
  const members = [...vault.members.values()].sort((a, b) => a.since - b.since);
  const d = modal(`
    <div class="row"><h2 class="grow">Settings</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <section><h3>Profile</h3>
      <div class="row"><input id="p-name" class="grow" maxlength="40" value="${esc(s.name)}"><button class="btn" id="p-save">Save</button></div>
      <p class="muted small">Members: ${members.map((m) => `<span class="author p${memberIndex(m.id)}">${esc(m.name)}</span>`).join(', ')}</p>
    </section>
    <section><h3>Sync</h3>
      <p class="muted small">Repo <code>${esc(s.repo)}</code> · branch <code>${esc(s.branch)}</code><br>Last sync: ${esc(ago(s.lastSync))} · ${n} item(s) waiting to upload</p>
      <label class="check"><input type="checkbox" id="o-auto" ${s.autoSync ? 'checked' : ''}> Upload automatically after posting (and every 2 min). The app always pulls when it opens.</label>
      <label class="check"><input type="checkbox" id="o-comp" ${s.compress !== false ? 'checked' : ''}> Compress photos (smaller repo, removes location data)</label>
      <div class="row"><button class="btn" id="o-sync">${icon('sync')} Sync now</button><button class="btn ghost" id="o-token">Change token</button></div>
    </section>
    <section><h3>Devices</h3>
      <p class="muted small">Setup codes contain the vault key. Only show them in person or send them through a channel you trust.</p>
      <div class="row wrap"><button class="btn" id="d-mine">Add another of my devices</button><button class="btn" id="d-partner">Invite the other person</button></div>
    </section>
    <section><h3>Locked chats</h3>
      <p class="muted small">${vault.pin ? `One shared 4-digit PIN unlocks every locked chat (set by ${esc(nameOf(vault.pin.by))}). Lock a chat from its settings (ⓘ).` : 'No PIN yet. Lock a chat from its settings (ⓘ) and you’ll be asked to choose one.'}</p>
      ${vault.pin ? `<div class="row"><button class="btn ghost" id="pin-change">Change PIN</button></div>` : ''}
    </section>
    <section><h3>App lock</h3>
      <p class="muted small">${s.lock ? 'App lock is on. The vault key and token on this device are encrypted with your passphrase; it locks after 5 minutes in the background.' : 'Add a passphrase so nobody holding this unlocked device can open the vault.'}</p>
      <div class="row wrap">${s.lock ? `<button class="btn" id="l-now">${icon('lock')} Lock now</button><button class="btn ghost" id="l-change">Change passphrase</button><button class="btn ghost" id="l-off">Remove lock</button>` : `<button class="btn" id="l-on">${icon('lock')} Set passphrase</button>`}</div>
    </section>
    <section><h3>Data</h3>
      <p class="muted small">${usage}${vault.rejected ? ` · ${vault.rejected} invalid event(s) ignored` : ''}</p>
      <div class="row wrap"><button class="btn ghost" id="x-json">${icon('download')} Export text archive (JSON)</button><button class="btn ghost danger-text" id="x-wipe">Remove vault from this device</button></div>
    </section>`, { cls: 'wide' });
  const on = (id, fn) => $(id, d.el)?.addEventListener('click', fn);
  on('#p-save', async () => { const v = $('#p-name', d.el).value.trim(); if (v && v !== s.name) { await vault.setName(v); toast('Name updated'); } });
  $('#o-auto', d.el).onchange = async (e) => { s.autoSync = e.target.checked; await vault.saveSettings(); };
  $('#o-comp', d.el).onchange = async (e) => { s.compress = e.target.checked; await vault.saveSettings(); };
  on('#o-sync', () => doSync(true));
  on('#o-token', () => {
    const t = modal(`<h2>Change GitHub token</h2><p class="muted small">Use this when the token expires. It needs Contents: Read and write on <code>${esc(s.repo)}</code>.</p>
      <input id="t-new" type="password" placeholder="github_pat_…" autofocus><div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="t-save">Save</button></div>`);
    $('#t-save', t.el).onclick = async () => {
      try { await vault.updateToken($('#t-new', t.el).value); toast('Token updated', 'ok'); t.close(); doSync(true); }
      catch (e) { toast(e.message, 'bad'); }
    };
  });
  on('#d-mine', () => codeDialog(true));
  on('#pin-change', async () => {
    if (!(await pinPad({ title: 'Current PIN', check: (p) => vault.checkPin(p) }))) return;
    await setPinFlow('New PIN', 'This changes it for both of you.');
  });
  on('#d-partner', () => codeDialog(false));
  const passDialog = (title) => {
    const p = modal(`<h2>${title}</h2><p class="muted small">There is no way to recover a forgotten passphrase, but you can always re-join from another device with a setup code.</p>
      <input id="pp1" type="password" placeholder="Passphrase" autofocus autocomplete="new-password"><input id="pp2" type="password" placeholder="Repeat passphrase" autocomplete="new-password">
      <div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pp-ok">Save</button></div>`);
    $('#pp-ok', p.el).onclick = async () => {
      const a = $('#pp1', p.el).value, b = $('#pp2', p.el).value;
      if (a.length < 6) return toast('Use at least 6 characters', 'bad');
      if (a !== b) return toast('Passphrases don’t match', 'bad');
      await vault.setPassphrase(a); toast('App lock on', 'ok'); p.close(); d.close();
    };
  };
  on('#l-on', () => passDialog('Set passphrase'));
  on('#l-change', () => passDialog('Change passphrase'));
  on('#l-off', async () => { await vault.setPassphrase(null); toast('App lock removed'); d.close(); });
  on('#l-now', () => location.reload());
  on('#x-json', () => {
    const blob = new Blob([JSON.stringify(vault.exportJSON(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `twofold-archive-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove();
  });
  on('#x-wipe', async () => {
    const waiting = await vault.pendingCount();
    if (await confirmBox('Remove vault from this device?', waiting ? `${waiting} item(s) have NOT been uploaded yet and will be lost. Sync first if you can.` : 'Everything is synced and safe in the repo. You can join again later with a setup code.', 'Remove', true)) {
      await vault.wipeDevice(); localStorage.clear(); location.reload();
    }
  });
}

function codeDialog(forMyDevice) {
  const d = modal(`
    <div class="row"><h2 class="grow">${forMyDevice ? 'Add another of my devices' : 'Invite the other person'}</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <p class="muted small">${forMyDevice
      ? 'On the new device open the app → “Join with a setup code” → Scan QR. This code contains <b>your identity and the vault key</b> – treat it like a password.'
      : 'On their device: open the app → “Join with a setup code” → Scan QR, then enter their name. This code contains <b>the vault key</b> – treat it like a password.'}</p>
    <label class="check"><input type="checkbox" id="k-tok" checked> Include the GitHub token (otherwise they paste their own)</label>
    <div class="qr" id="k-qr"></div>
    <textarea id="k-code" rows="3" readonly spellcheck="false"></textarea>
    <div class="row end"><button class="btn ghost" id="k-copy">${icon('copy')} Copy code</button></div>`);
  const draw = () => {
    const code = vault.makeCode({ forMyDevice, includeToken: $('#k-tok', d.el).checked });
    $('#k-code', d.el).value = code;
    const box = $('#k-qr', d.el);
    if (window.qrcode) {
      try {
        const q = window.qrcode(0, 'L'); q.addData(code); q.make();
        box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
      } catch { box.textContent = 'Code too long for a QR – copy it instead.'; }
    }
  };
  $('#k-tok', d.el).onchange = draw;
  $('#k-copy', d.el).onclick = async () => { await navigator.clipboard?.writeText($('#k-code', d.el).value).catch(() => {}); toast('Copied – paste it only somewhere private'); };
  draw();
}

// ---------------- QR scanner ----------------
async function scanQR(onCode) {
  if (!navigator.mediaDevices?.getUserMedia || !window.jsQR) return toast('Camera not available here – paste the code instead', 'bad');
  let stream, raf, stopped = false;
  const d = modal(`<div class="row"><h2 class="grow">Scan setup code</h2><button class="icon-btn" data-close>${icon('x')}</button></div>
    <div class="scanner"><video playsinline muted></video><div class="scan-frame"></div></div><p class="muted small">Point the camera at the QR code on the other device.</p>`,
  { onClose: () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); } });
  const video = $('video', d.el);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    video.srcObject = stream;
    await video.play();
  } catch (e) { d.close(); return toast('Could not open camera: ' + e.message, 'bad'); }
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stopped) return;
    if (video.readyState >= 2) {
      const w = video.videoWidth, h = video.videoHeight, scale = Math.min(1, 800 / Math.max(w, h));
      canvas.width = w * scale; canvas.height = h * scale;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (r?.data?.startsWith('TF1.')) { d.close(); onCode(r.data); return; }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
}

start();
