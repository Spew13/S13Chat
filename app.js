/* app.js — S13Chat JSONBin client
   IMPORTANT: Do NOT commit your master key to a public repo.
   This file is written to work with the HTML/CSS scaffolding you provided.
*/

/* ----------------- CONFIG (fill carefully) ----------------- */
/* You gave these values; I've placed them here for convenience.
   Consider replacing the master key with a read-only access key or
   proxying requests through a small server to keep secrets safe. */
const JSONBIN_BASE = 'https://api.jsonbin.io/v3/b';
const SERVERS_BIN_ID = '68ecef49ae596e708f113ce5';         // your bin id
const JSONBIN_MASTER_KEY = '$2a$10$SjcbvSnjiyFfuDwOzew2b.CtowaaptWCm38KZikWrQJRgyCp3owqS'; // master key (sensitive)

/* ----------------- Simple helpers ----------------- */
const headersWithMaster = () => ({
  'Content-Type': 'application/json',
  'X-Master-Key': JSONBIN_MASTER_KEY,
});

/* Fetch the entire bin object */
async function fetchBin(binId = SERVERS_BIN_ID) {
  const url = `${JSONBIN_BASE}/${binId}`;
  const res = await fetch(url, { method: 'GET', headers: headersWithMaster() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to fetch bin: ${res.status} ${txt}`);
  }
  const payload = await res.json();
  // JSONBin v3 returns { record: <your-json>, ...metadata }
  return payload.record ?? payload;
}

/* Overwrite the whole bin (simple approach) */
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

/* Create a minimal default structure if the bin is empty */
function ensureDefaultStructure(record) {
  if (!record || typeof record !== 'object') {
    record = {};
  }
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
  if (!Array.isArray(record.members)) record.members = [];
  return record;
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

let APP = {
  record: null,
  activeServerId: 'default',
  activeChannelId: 'general',
  pollingInterval: 3000,
  lastRenderHash: null
};

/* ----------------- Render helpers ----------------- */
function clearChildren(el){ while(el && el.firstChild) el.removeChild(el.firstChild); }

function renderServers() {
  clearChildren(compactServerList);
  const servers = APP.record.servers || [];
  servers.forEach(s => {
    const li = document.createElement('li');
    li.className = 'server-icon' + (s.id === APP.activeServerId ? ' active' : '');
    li.dataset.serverId = s.id;
    li.tabIndex = 0;
    li.title = s.name;
    li.innerHTML = `<span class="server-initial">${(s.name[0]||'S').toUpperCase()}</span>`;
    li.addEventListener('click', () => { selectServer(s.id); });
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectServer(s.id);
    });
    compactServerList.appendChild(li);
  });
}

function renderChannels() {
  clearChildren(channelList);
  const server = APP.record.servers.find(s => s.id === APP.activeServerId);
  if (!server) return;
  server.channels.forEach(ch => {
    const li = document.createElement('li');
    li.className = 'channel-item' + (ch.id === APP.activeChannelId ? ' active' : '');
    li.dataset.channelId = ch.id;
    li.textContent = `# ${ch.name}`;
    li.tabIndex = 0;
    li.addEventListener('click', () => { selectChannel(ch.id); });
    li.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') selectChannel(ch.id);
    });
    channelList.appendChild(li);
  });
  serverNameEl.textContent = server.name;
  // member count if present
  const memberCountEl = document.getElementById('memberCount');
  if(memberCountEl) memberCountEl.textContent = (server.members||[]).length;
}

function renderMessages() {
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
          <span class="msg-time">${new Date(msg.ts).toLocaleTimeString()}</span>
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

/* small escape to avoid XSS from content stored in JSONBin */
function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ----------------- Selection & UI actions ----------------- */
function selectServer(serverId) {
  APP.activeServerId = serverId;
  const server = APP.record.servers.find(s => s.id === serverId);
  if (server && server.channels && server.channels[0]) {
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

/* ----------------- CRUD: servers / messages ----------------- */
async function loadRecord() {
  try {
    const payload = await fetchBin(SERVERS_BIN_ID);
    APP.record = ensureDefaultStructure(payload);
    renderServers();
    renderChannels();
    renderMessages();
  } catch (err) {
    console.error('loadRecord error', err);
    // fallback to default structure if read failed
    APP.record = ensureDefaultStructure(APP.record);
    renderServers();
    renderChannels();
    renderMessages();
  }
}

/* Create a new server in-record and push to JSONBin */
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
  // select the new server
  selectServer(id);
}

/* Append message to the active channel and update bin */
async function sendMessage(text, author = 'Guest') {
  if (!text || !text.trim()) return;
  const server = APP.record.servers.find(s => s.id === APP.activeServerId);
  if (!server) return;
  const channel = server.channels.find(c => c.id === APP.activeChannelId);
  if (!channel) return;
  const msg = {
    id: 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
    author,
    text,
    ts: new Date().toISOString(),
    avatar: `https://api.dicebear.com/6.x/identicon/svg?seed=${encodeURIComponent(author)}` // fun avatar generator
  };
  channel.messages.push(msg);
  // optimistic UI update:
  renderMessages();
  try {
    await pushRecord();
  } catch (err) {
    console.error('Failed to send message', err);
    // keep UI optimistic; optionally inform user
  }
}

/* Push the full record to JSONBin (overwrite) */
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

/* ----------------- Utilities ----------------- */
function slugify(text = '') {
  return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g,'').replace(/\-+/g,'-');
}

/* ----------------- Polling for updates (simple live-ish) ----------------- */
let pollTimer = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const remote = await fetchBin(SERVERS_BIN_ID);
      const remoteRecord = ensureDefaultStructure(remote);
      // Simple change detection using JSON stringify (cheap)
      const currentStr = JSON.stringify(APP.record || {});
      const remoteStr = JSON.stringify(remoteRecord);
      if (currentStr !== remoteStr) {
        APP.record = remoteRecord;
        // attempt to maintain selection if possible
        const serverExists = APP.record.servers.some(s => s.id === APP.activeServerId);
        if (!serverExists) APP.activeServerId = APP.record.servers[0]?.id || null;
        renderServers();
        renderChannels();
        renderMessages();
      }
    } catch (err) {
      console.warn('poll error', err);
    }
  }, APP.pollingInterval);
}

/* ----------------- Discover modal (search servers) ----------------- */
function openDiscover() { discoverModal.classList.remove('hidden'); discoverSearchInput && discoverSearchInput.focus(); }
function closeDiscover() { discoverModal.classList.add('hidden'); clearChildren(discoverResults); }

async function searchPublicServers(query = '') {
  // In this simple app, all servers live in the same bin.
  // We'll search through APP.record.servers for name/desc/tag matches.
  const q = String(query||'').trim().toLowerCase();
  const results = (APP.record.servers || []).filter(s => {
    if (!q) return s.visibility === 'public';
    return (s.name && s.name.toLowerCase().includes(q))
      || (s.desc && s.desc.toLowerCase().includes(q))
      || (s.visibility && s.visibility === 'public');
  });
  // render results
  clearChildren(discoverResults);
  if (results.length === 0) {
    const p = document.createElement('div');
    p.className = 'small muted';
    p.textContent = 'No servers found';
    discoverResults.appendChild(p);
    return;
  }
  results.forEach(s => {
    const tpl = document.getElementById('tpl-server-card');
    const clone = tpl.content.cloneNode(true);
    const card = clone.querySelector('.server-card');
    card.dataset.serverId = s.id;
    card.querySelector('.server-card-name').textContent = s.name;
    card.querySelector('.server-card-meta').textContent = `${s.visibility} • ${ (s.members||[]).length } members`;
    const btn = clone.querySelector('.btn-join');
    btn.addEventListener('click', () => {
      // "join" = add current "Guest" member to server.members and select it
      if (!s.members) s.members = [];
      if (!s.members.includes('Guest')) s.members.push('Guest');
      // write back
      pushRecord().then(() => {
        selectServer(s.id);
        closeDiscover();
      });
    });
    discoverResults.appendChild(clone);
  });
}

/* ----------------- Event bindings ----------------- */
function bindUI() {
  // message send
  if (messageForm) {
    messageForm.addEventListener('submit', async e => {
      e.preventDefault();
      const txt = messageInput.value;
      await sendMessage(txt, 'Guest');
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
      discoverSearchInput.addEventListener('input', e => {
        searchPublicServers(e.target.value);
      });
    }
  }

  // create server modal
  if (createServerBtn) createServerBtn.addEventListener('click', () => {
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
}

/* ----------------- Boot ----------------- */
(async function boot() {
  try {
    await loadRecord();
    bindUI();
    startPolling();
    // initial search render for discover
    if (discoverResults) searchPublicServers('');
  } catch (err) {
    console.error('Boot failed', err);
  }
})();
