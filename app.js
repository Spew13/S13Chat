/* app.js — S13Chat v2 with simple custom signup/signin
   - Uses JSONBin v3 (GET / PUT)
   - Stores servers, members, channels, and messages in a single bin
   - Client-side account signup with SHA-256 password hashing
   - Session stored in localStorage under "s13_user"
   IMPORTANT: don't commit your master key to public repos.
*/

/* ----------------- CONFIG - put your keys here ----------------- */
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';
const SERVERS_BIN_ID = '68ecef49ae596e708f113ce5'; // your bin id
const JSONBIN_MASTER_KEY = '$2a$10$SjcbvSnjiyFfuDwOzew2b.CtowaaptWCm38KZikWrQJRgyCp3owqS'; // master key (sensitive)
/* ---------------------------------------------------------------- */

/* ----------------- Utilities ----------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...args) => console.log('[S13Chat]', ...args);
const err = (...args) => console.error('[S13Chat]', ...args);

/* Basic headers for JSONBin calls */
const headersWithMaster = () => ({
  'Content-Type': 'application/json',
  'X-Master-Key': JSONBIN_MASTER_KEY,
});

/* Safe HTML escape to avoid XSS when inserting messages */
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* Compute SHA-256 hex digest of a string using Web Crypto API */
async function sha256Hex(msg) {
  const enc = new TextEncoder();
  const data = enc.encode(msg);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ----------------- DOM references ----------------- */
const compactServerList = document.getElementById('compactServerList');
const serverNameEl = document.getElementById('serverName');
const channelList = document.getElementById('channelList');
const messagesList = document.getElementById('messagesList');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const discoverBtn = document.getElementById('discoverBtn');
const discoverModal = document.getElementById('discoverModal');
const discoverSearchInput = document.getElementById('discoverSearchInput');
const discoverResults = document.getElementById('discoverResults');
const createServerBtn = document.getElementById('createServerBtn');
const createServerModal = document.getElementById('createServerModal');
const createServerForm = document.getElementById('createServerForm');
const signInBtn = document.getElementById('signInBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userNameDisplay = document.getElementById('userNameDisplay') || document.getElementById('userName') || document.getElementById('userNameDisplay');

/* ----------------- App state ----------------- */
const APP = {
  record: null,
  activeServerId: 'default',
  activeChannelId: 'general',
  pollingInterval: 3000,
  currentUser: null // { username, avatarSeed }
};

/* ----------------- JSONBin helpers ----------------- */
async function fetchBin(binId = SERVERS_BIN_ID) {
  const url = `${JSONBIN_BASE}/${binId}`;
  const res = await fetch(url, { method: 'GET', headers: headersWithMaster() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch bin: ${res.status} ${txt}`);
  }
  const payload = await res.json();
  return payload.record ?? payload;
}

async function updateBin(binId = SERVERS_BIN_ID, record) {
  const url = `${JSONBIN_BASE}/${binId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: headersWithMaster(),
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to update bin: ${res.status} ${txt}`);
  }
  const payload = await res.json();
  return payload;
}

/* Ensure bin structure */
function ensureDefaultStructure(record) {
  if (!record || typeof record !== 'object') record = {};
  if (!Array.isArray(record.servers)) record.servers = [
    {
      id: 'default',
      name: 'General',
      desc: 'Welcome to S13Chat — general',
      visibility: 'public',
      members: [],
      channels: [
        { id: 'general', name: 'general', messages: [] }
      ],
    }
  ];
  if (!Array.isArray(record.members)) record.members = []; // { username, pwHash, avatarSeed, createdAt }
  return record;
}

/* Push full record (overwrite) */
let pushing = false;
async function pushRecord() {
  if (pushing) return;
  pushing = true;
  try {
    await updateBin(SERVERS_BIN_ID, APP.record);
  } finally {
    pushing = false;
  }
}

/* ----------------- Rendering ----------------- */
function clearChildren(el){ while (el && el.firstChild) el.removeChild(el.firstChild); }

function renderServers() {
  if (!compactServerList) return;
  clearChildren(compactServerList);
  const servers = APP.record.servers || [];
  servers.forEach(s => {
    const li = document.createElement('li');
    li.className = 'server-icon' + (s.id === APP.activeServerId ? ' active' : '');
    li.dataset.serverId = s.id;
    li.tabIndex = 0;
    li.title = s.name;
    li.innerHTML = `<span class="server-initial">${(s.name[0]||'S').toUpperCase()}</span>`;
    li.addEventListener('click', () => selectServer(s.id));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectServer(s.id); });
    compactServerList.appendChild(li);
  });
}

function renderChannels() {
  if (!channelList) return;
  clearChildren(channelList);
  const server = APP.record.servers.find(s => s.id === APP.activeServerId);
  if (!server) return;
  server.channels.forEach(ch => {
    const li = document.createElement('li');
    li.className = 'channel-item' + (ch.id === APP.activeChannelId ? ' active' : '');
    li.dataset.channelId = ch.id;
    li.textContent = `# ${ch.name}`;
    li.tabIndex = 0;
    li.addEventListener('click', () => selectChannel(ch.id));
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectChannel(ch.id); });
    channelList.appendChild(li);
  });
  if (serverNameEl) serverNameEl.textContent = server.name;
  const memberCountEl = document.getElementById('memberCount');
  if(memberCountEl) memberCountEl.textContent = (server.members||[]).length;
}

function renderMessages() {
  if (!messagesList) return;
  clearChildren(messagesList);
  const server = APP.record.servers.find(s => s.id === APP.activeServerId);
  if (!server) return;
  const channel = server.channels.find(c => c.id === APP.activeChannelId);
  if (!channel) return;
  channel.messages.forEach(msg => {
    const item = document.createElement('li');
    item.className = 'message';
    item.dataset.messageId = msg.id;
    item.innerHTML = `
      <img class="msg-avatar" src="${msg.avatar||'https://via.placeholder.com/40'}" alt="avatar">
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-author">${escapeHtml(msg.author||'Guest')}</span>
          <span class="msg-time">${new Date(msg.ts).toLocaleString()}</span>
        </div>
        <div class="msg-text">${escapeHtml(msg.text)}</div>
      </div>
    `;
    messagesList.appendChild(item);
  });
  // scroll to bottom
  const wrap = document.getElementById('messagesWrap');
  if (wrap) wrap.scrollTop = wrap.scrollHeight;
}

/* ----------------- Selection ----------------- */
function selectServer(serverId) {
  APP.activeServerId = serverId;
  const server = APP.record.servers.find(s => s.id === serverId);
  if (server && server.channels && server.channels.length) {
    APP.activeChannelId = server.channels[0].id;
  } else {
    APP.activeChannelId = null;
  }
  renderServers();
  renderChannels();
  renderMessages();
}

function selectChannel(channelId) {
  APP.activeChannelId = channelId;
  renderChannels();
  renderMessages();
}

/* ----------------- Messaging ----------------- */
async function sendMessage(text) {
  if (!text || !text.trim()) return;
  const server = APP.record.servers.find(s => s.id === APP.activeServerId);
  if (!server) { err('No server selected'); return; }
  const channel = server.channels.find(c => c.id === APP.activeChannelId);
  if (!channel) { err('No channel selected'); return; }

  const username = APP.currentUser ? APP.currentUser.username : 'Guest';
  const avatarSeed = APP.currentUser ? APP.currentUser.avatarSeed : username;

  const msg = {
    id: 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
    author: username,
    text,
    ts: new Date().toISOString(),
    avatar: `https://api.dicebear.com/6.x/identicon/svg?seed=${encodeURIComponent(avatarSeed)}`
  };

  channel.messages.push(msg);
  // optimistic UI
  renderMessages();
  try {
    await pushRecord();
  } catch (e) {
    err('Failed to push message', e);
  }
}

/* ----------------- Signup / Signin ----------------- */

/*
  Accounts stored in APP.record.members:
    { username, pwHash, avatarSeed, createdAt }
  pwHash is hex SHA-256 of password+username (simple salt)
*/

/* Signup: creates new user if username unique */
async function signup(username, password) {
  username = String(username || '').trim();
  if (!username) throw new Error('Username required');
  if (!password || String(password).length < 4) throw new Error('Password must be at least 4 characters');

  // check uniqueness
  if ((APP.record.members||[]).some(m => m.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('Username already exists');
  }

  const pwHash = await sha256Hex(password + '|' + username);
  const avatarSeed = username + '-' + Date.now().toString(36).slice(-4);
  const user = { username, pwHash, avatarSeed, createdAt: new Date().toISOString() };
  APP.record.members.push(user);
  await pushRecord();
  setCurrentUser({ username, avatarSeed });
  log('User created:', username);
  return user;
}

/* Signin: verify password */
async function signin(username, password) {
  const user = (APP.record.members||[]).find(m => m.username.toLowerCase() === String(username||'').toLowerCase());
  if (!user) throw new Error('User not found');
  const pwHash = await sha256Hex(password + '|' + user.username);
  if (pwHash !== user.pwHash) throw new Error('Incorrect password');
  setCurrentUser({ username: user.username, avatarSeed: user.avatarSeed });
  log('Signed in:', user.username);
  return user;
}

/* Signout */
function signout() {
  APP.currentUser = null;
  localStorage.removeItem('s13_user');
  updateAuthUI();
}

/* Save session in localStorage */
function setCurrentUser(u) {
  APP.currentUser = u;
  localStorage.setItem('s13_user', JSON.stringify(u));
  updateAuthUI();
}

/* Load saved session */
function loadSavedUser() {
  try {
    const raw = localStorage.getItem('s13_user');
    if (raw) {
      APP.currentUser = JSON.parse(raw);
    }
  } catch (e) { /* ignore */ }
  updateAuthUI();
}

/* Update auth UI: username display & sign-in/out visibility */
function updateAuthUI() {
  const name = APP.currentUser ? APP.currentUser.username : 'Guest';
  const userNameEls = document.querySelectorAll('#userNameDisplay, #userName');
  userNameEls.forEach(el => { el.textContent = name; });
  if (signInBtn) signInBtn.style.display = APP.currentUser ? 'none' : '';
  if (signOutBtn) signOutBtn.style.display = APP.currentUser ? '' : 'none';
}

/* ----------------- Discover (search/join) ----------------- */
function openDiscover() {
  if (!discoverModal) return;
  discoverModal.classList.remove('hidden');
  if (discoverSearchInput) discoverSearchInput.focus();
  renderDiscover('');
}
function closeDiscover() {
  if (!discoverModal) return;
  discoverModal.classList.add('hidden');
  clearChildren(discoverResults);
}

/* Simple search across server name/desc */
function renderDiscover(query = '') {
  if (!discoverResults) return;
  clearChildren(discoverResults);
  const q = String(query || '').trim().toLowerCase();
  const results = (APP.record.servers || []).filter(s => {
    if (!q) return s.visibility === 'public';
    return (s.name && s.name.toLowerCase().includes(q)) ||
           (s.desc && s.desc.toLowerCase().includes(q)) ||
           (s.tags && s.tags.join(' ').toLowerCase().includes(q));
  });
  if (results.length === 0) {
    const p = document.createElement('div');
    p.className = 'small muted';
    p.textContent = 'No servers found';
    discoverResults.appendChild(p);
    return;
  }
  results.forEach(s => {
    const tpl = document.getElementById('tpl-server-card');
    if (!tpl) {
      // fallback quick card
      const fallback = document.createElement('div');
      fallback.textContent = `${s.name} • ${s.visibility}`;
      discoverResults.appendChild(fallback);
      return;
    }
    const clone = tpl.content.cloneNode(true);
    const card = clone.querySelector('.server-card');
    card.dataset.serverId = s.id;
    card.querySelector('.server-card-name').textContent = s.name;
    card.querySelector('.server-card-meta').textContent = `${s.visibility} • ${ (s.members||[]).length } members`;
    const btn = clone.querySelector('.btn-join');
    btn.addEventListener('click', async () => {
      // join flow
      try {
        if (!APP.currentUser) {
          // encourage sign-in
          await askSignInModal();
          if (!APP.currentUser) return;
        }
        if (!s.members) s.members = [];
        if (!s.members.includes(APP.currentUser.username)) s.members.push(APP.currentUser.username);
        await pushRecord();
        selectServer(s.id);
        closeDiscover();
      } catch (e) {
        err('Join failed', e);
        alert('Failed to join server: ' + (e.message || e));
      }
    });
    discoverResults.appendChild(clone);
  });
}

/* ----------------- Small UI modals for sign-in/sign-up ----------------- */

/* Creates a small modal form (signup or signin) and resolves with {username, password} or null */
function createAuthModal(kind = 'signin') {
  return new Promise(resolve => {
    // modal container
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = 2000;
    modal.innerHTML = `
      <div class="modal-panel" style="width:380px;">
        <header class="modal-header">
          <h2 id="authTitle">${kind === 'signup' ? 'Create account' : 'Sign in'}</h2>
          <button class="modal-close" data-action="close" aria-label="Close">✕</button>
        </header>
        <div class="modal-body">
          <label>Username
            <input id="authUsername" class="input" type="text" required />
          </label>
          <label>${kind === 'signup' ? 'Password (min 4 chars)' : 'Password'}
            <input id="authPassword" class="input" type="password" required />
          </label>
          ${kind === 'signup' ? `<label>Confirm password
            <input id="authPassword2" class="input" type="password" />
          </label>` : ''}
          <div class="modal-actions" style="display:flex; gap:8px; justify-content:flex-end;">
            <button id="authCancel" class="btn-flat">Cancel</button>
            <button id="authSubmit" class="btn-primary">${ kind === 'signup' ? 'Create' : 'Sign in'}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    // events
    modal.addEventListener('click', e => {
      if (e.target === modal || e.target.closest('[data-action="close"]')) {
        modal.remove();
        resolve(null);
      }
    });
    const inputU = modal.querySelector('#authUsername');
    const inputP = modal.querySelector('#authPassword');
    const inputP2 = modal.querySelector('#authPassword2');
    const btnCancel = modal.querySelector('#authCancel');
    const btnSubmit = modal.querySelector('#authSubmit');

    btnCancel.addEventListener('click', () => { modal.remove(); resolve(null); });

    btnSubmit.addEventListener('click', async () => {
      const username = inputU.value.trim();
      const password = inputP.value;
      if (!username) { alert('Username required'); return; }
      if (!password) { alert('Password required'); return; }
      if (kind === 'signup') {
        const password2 = inputP2.value;
        if (password !== password2) { alert('Passwords do not match'); return; }
        if (password.length < 4) { alert('Password too short'); return; }
      }
      modal.remove();
      resolve({ username, password });
    });

    setTimeout(() => inputU.focus(), 40);
  });
}

/* Helper that opens signin modal and tries to sign in; if signin fails, offer to signup */
async function askSignInModal() {
  const res = await createAuthModal('signin');
  if (!res) return null;
  try {
    await signin(res.username, res.password);
    return APP.currentUser;
  } catch (e) {
    // if not found or wrong password, offer signup
    const shouldCreate = confirm((e.message || 'Sign in failed') + '\nDo you want to create a new account with that username?');
    if (shouldCreate) {
      const res2 = await createAuthModal('signup');
      if (!res2) return null;
      try {
        await signup(res2.username, res2.password);
        return APP.currentUser;
      } catch (errCreate) {
        alert('Signup failed: ' + (errCreate.message || errCreate));
        return null;
      }
    }
    return null;
  }
}

/* ----------------- Event bindings ----------------- */
function bindUI() {
  // message send
  if (messageForm) {
    messageForm.addEventListener('submit', async e => {
      e.preventDefault();
      const txt = messageInput.value;
      if (!txt || !txt.trim()) return;
      await sendMessage(txt.trim());
      messageInput.value = '';
      messageInput.focus();
    });
  }

  // discover modal
  if (discoverBtn) discoverBtn.addEventListener('click', openDiscover);
  if (discoverModal) {
    discoverModal.addEventListener('click', (e) => {
      if (e.target === discoverModal) closeDiscover();
      const closeBtn = e.target.closest('[data-action="close"]');
      if (closeBtn) closeDiscover();
    });
    if (discoverSearchInput) {
      discoverSearchInput.addEventListener('input', e => renderDiscover(e.target.value));
    }
  }

  // create server modal
  if (createServerBtn) createServerBtn.addEventListener('click', () => {
    if (!createServerModal) return;
    createServerModal.classList.remove('hidden');
    const input = createServerModal.querySelector('#newServerName');
    if (input) input.focus();
  });
  if (createServerModal) {
    createServerModal.addEventListener('click', (e) => {
      if (e.target === createServerModal) createServerModal.classList.add('hidden');
      const closeBtn = e.target.closest('[data-action="close"]');
      if (closeBtn) createServerModal.classList.add('hidden');
      const cancelBtn = e.target.closest('[data-action="cancel"]');
      if (cancelBtn) createServerModal.classList.add('hidden');
    });
  }
  if (createServerForm) {
    createServerForm.addEventListener('submit', async e => {
      e.preventDefault();
      const name = document.getElementById('newServerName').value.trim();
      const desc = document.getElementById('newServerDesc').value.trim();
      const vis = document.getElementById('newServerVisibility').value;
      if (!name) return;
      await createServer({ name, description: desc, visibility: vis });
      createServerModal.classList.add('hidden');
    });
  }

  // auth buttons
  if (signInBtn) {
    signInBtn.addEventListener('click', async () => {
      await askSignInModal();
    });
  }
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      signout();
    });
  }
}

/* ----------------- Create server (same as before) ----------------- */
async function createServer({ name, description = '', visibility = 'public' }) {
  const id = slugify(name) + '-' + Date.now().toString(36).slice(-6);
  const serverObj = {
    id,
    name,
    desc: description,
    visibility,
    members: [],
    channels: [
      { id: 'general', name: 'general', messages: [] }
    ],
  };
  APP.record.servers.push(serverObj);
  await pushRecord();
  selectServer(id);
}

/* ----------------- Polling for remote updates ----------------- */
let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const remote = await fetchBin(SERVERS_BIN_ID);
      const remoteRecord = ensureDefaultStructure(remote);
      const currentStr = JSON.stringify(APP.record || {});
      const remoteStr = JSON.stringify(remoteRecord);
      if (currentStr !== remoteStr) {
        APP.record = remoteRecord;
        // maintain selection if possible
        const serverExists = APP.record.servers.some(s => s.id === APP.activeServerId);
        if (!serverExists) APP.activeServerId = APP.record.servers[0]?.id || null;
        renderServers();
        renderChannels();
        renderMessages();
      }
    } catch (e) {
      // polling errors are non-fatal; log for debugging
      console.warn('[S13Chat] poll error', e);
    }
  }, APP.pollingInterval);
}

/* ----------------- Boot ----------------- */
async function loadRecord() {
  try {
    const payload = await fetchBin(SERVERS_BIN_ID);
    APP.record = ensureDefaultStructure(payload);
  } catch (e) {
    err('loadRecord error', e);
    APP.record = ensureDefaultStructure(APP.record);
  }
  // ensure default server selection
  if (!APP.record.servers || !APP.record.servers.length) {
    APP.record = ensureDefaultStructure(APP.record);
  }
  // if active server doesn't exist, set to first
  if (!APP.record.servers.find(s => s.id === APP.activeServerId)) {
    APP.activeServerId = APP.record.servers[0].id;
    APP.activeChannelId = APP.record.servers[0].channels[0].id;
  }
  renderServers();
  renderChannels();
  renderMessages();
}

/* ----------------- Helpers ----------------- */
function slugify(text = '') {
  return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g,'').replace(/\-+/g,'-');
}

/* ----------------- Start app ----------------- */
(async function boot() {
  try {
    // quick sanity check for bin access (logs to console)
    try {
      const test = await fetchBin(SERVERS_BIN_ID);
      log('Bin OK — loaded record preview:', { servers: (test.servers||[]).length, members: (test.members||[]).length });
    } catch (e) {
      err('Failed initial bin fetch. Check keys & CORS. Error:', e.message || e);
    }

    await loadRecord();
    loadSavedUser();
    bindUI();
    startPolling();

    // initial render discover results (public servers)
    if (discoverResults) renderDiscover('');
  } catch (e) {
    err('Boot failed', e);
  }
})();
