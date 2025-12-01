 // app.js (JSONBIN.io conversion)

// ---------- JSONBIN.io Config ----------
// !! IMPORTANT: REPLACE THESE WITH YOUR ACTUAL KEYS AND BIN ID !!
const JSONBIN_MASTER_KEY = '$2a$10$SjcbvSnjiyFfuDwOzew2b.CtowaaptWCm38KZikWrQJRgyCp3owqS'; 
const CHAT_BIN_ID = '692dacf1ae596e708f7c6fd1'; // ID of the bin holding ALL chat data
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${CHAT_BIN_ID}`;

const GET_HEADERS = { 'X-Master-Key': JSONBIN_MASTER_KEY }; // Use if your bin is private
const PUT_HEADERS = {
  'Content-Type': 'application/json',
  'X-Master-Key': JSONBIN_MASTER_KEY, // Required for writing/updating
};

// ---------- Global State ----------
let currentUser = null;
let currentServer = null;
let currentChannel = null;
let members = {};
let fullData = { servers: [], messages: [], profiles: [] }; // The entire content of the JSONBin
let lastDataVersion = null; // To track changes for polling

// Polling interval (JSONBIN.io does not support Realtime)
const POLLING_INTERVAL = 3000; // Poll every 3 seconds

// ---------- Utility Functions for JSONBin ----------

// app.js (Updated functions)

// Helper function to fetch only metadata
async function fetchMetadata() {
  try {
    // Note: Fetching the bin's URL without '/latest' returns metadata by default in v3
    const response = await fetch(JSONBIN_URL, { headers: GET_HEADERS });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return result.metadata;
  } catch (error) {
    console.error("Error fetching JSONBin metadata:", error);
    return null;
  }
}

// Fetches the entire JSON bin content (only called if the version has changed)
async function fetchFullData() {
  try {
    const response = await fetch(`${JSONBIN_URL}/latest`, { headers: GET_HEADERS });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    
    // Update the version tracker whenever we successfully download data
    lastDataVersion = data.metadata.version; 
    
    return data.record;
  } catch (error) {
    console.error("Error fetching JSONBin data:", error);
    return null;
  }
}

// ⭐️ UPDATED POLLING LOGIC ⭐️
async function pollForUpdates() {
    // 1. Check if the version has changed first
    const metadata = await fetchMetadata();
    if (!metadata) return;

    if (metadata.version === lastDataVersion) {
        // console.log("Version unchanged. Skipping full download.");
        return; 
    }
    
    // 2. If the version is different, download the full data
    console.log(`Data change detected (v${lastDataVersion} -> v${metadata.version}). Downloading data...`);
    const currentData = await fetchFullData();
    if (!currentData) return; // Fetch failed
    
    // 3. Compare and process changes (We'll assume only messages change for "live" chat)
    
    // We only want to append NEW messages, not re-render the whole list.
    const currentMessagesCount = fullData.messages.length;
    const newMessagesCount = currentData.messages.length;

    if (newMessagesCount > currentMessagesCount) {
        // Only process and append the newly arrived messages
        const newMessages = currentData.messages.slice(currentMessagesCount);
        
        // Update the local full data object with the new data
        fullData = currentData; 
        
        console.log(`Appended ${newMessages.length} new message(s).`);
        
        // Filter out only messages relevant to the CURRENT channel
        newMessages
            .filter(msg => msg.server_id === currentServer.id && msg.channel_id === currentChannel.id)
            .forEach(msg => appendMessage(msg));
    } else {
        // Fallback for changes to servers or profiles, or if a message was deleted (less common)
        fullData = currentData;
        loadServers(false); // Reload server list
        
        // Re-render all messages if the counts are the same (e.g., profiles updated)
        const channelMessages = fullData.messages.filter(msg => 
            msg.server_id === currentServer.id && msg.channel_id === currentChannel.id
        );
        renderMessages(channelMessages);
    }
}

// ---------- Auth (Simplified for JSONBIN) ----------
async function guestLogin(displayName = "Guest") {
  // JSONBIN.io doesn't have Auth, so we rely on local ID generation and profile storage
  let userId = localStorage.getItem('s13_user_id');
  if (!userId) {
    userId = `guest-${Date.now()}`;
    localStorage.setItem('s13_user_id', userId);
  }
  
  // Create a local user object
  currentUser = { id: userId, display_name: displayName };
  
  // Update profiles array in the bin
  let profile = fullData.profiles.find(p => p.id === userId);
  if (!profile) {
      profile = { id: userId, display_name: displayName, avatar_url: '' };
      fullData.profiles.push(profile);
      await updateFullData(fullData);
  }

  // Update local member state and UI
  members[currentUser.id] = currentUser.display_name;
  document.getElementById('userName').textContent = currentUser.display_name;
  document.getElementById('signInBtn').classList.add('hidden');
  
  await initializeChat();
}

// ---------- Initialization and Polling ----------
// app.js (Entry Point Update)

async function initializeChat() {
    const data = await fetchFullData(); // Initial full fetch to get the current version
    if (data) {
        fullData = data;
        await loadServers();
        // Start polling for updates after initial load
        setInterval(pollForUpdates, POLLING_INTERVAL);
    }
}
// ... (The rest of your code)


// ---------- Servers (Load from fullData) ----------
async function loadServers(selectFirst = true) {
    const servers = fullData.servers;
    const serverContainer = document.getElementById('compactServerList');
    serverContainer.innerHTML = '';
    
    servers.forEach(server => {
      const listItem = tplServerIcon.content.firstElementChild.cloneNode(true);
      listItem.setAttribute('data-server-id', server.id);
      listItem.setAttribute('title', server.name);
      listItem.querySelector('.server-initial').textContent = server.name.charAt(0).toUpperCase();

      listItem.addEventListener('click', () => selectServer(server));
      serverContainer.appendChild(listItem);
    });

    // Auto-select the first server on load or if selectFirst is true
    if (selectFirst && servers.length > 0) {
      selectServer(servers[0]);
    } else if (currentServer) {
        // If not selecting first, ensure the current server is marked active
        document.querySelector(`.server-icon[data-server-id="${currentServer.id}"]`)?.classList.add('active');
    }
}

// Create server (Form submission for modal)
async function createServer(name, description, visibility) {
  if (!currentUser) return alert('Please sign in or use Guest login first.');
  
  // Create a unique server ID
  const newServerId = `s-${Date.now()}`;
  
  const newServer = {
      id: newServerId,
      name,
      description,
      visibility,
      created_by: currentUser.id,
      channels: [
          { id: '1', name: 'general' } // Default channel
      ]
  };
  
  fullData.servers.push(newServer);
  
  const updated = await updateFullData(fullData);
  if (updated) {
    document.getElementById('createServerModal').classList.add('hidden');
    loadServers(); // Re-render the server list
  }
}

function selectServer(server) {
  document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
  
  currentServer = server;
  // For simplicity, always use the first channel (ID '1') of the selected server
  const defaultChannel = server.channels.find(c => c.id === '1') || { id: '1', name: 'general' };
  currentChannel = defaultChannel;

  document.querySelector(`.server-icon[data-server-id="${server.id}"]`)?.classList.add('active');
  document.getElementById('serverName').textContent = server.name;
  document.getElementById('channelTitle').textContent = `# ${currentChannel.name}`;
  document.getElementById('serverId').textContent = server.id;

  // Load and render messages for the new channel
  const channelMessages = fullData.messages.filter(msg => 
      msg.server_id === server.id && msg.channel_id === currentChannel.id
  );
  renderMessages(channelMessages);
}

// ---------- Messages (Read/Write from fullData) ----------

// Replaces loadMessages
function renderMessages(messages) {
  const messagesList = document.getElementById('messagesList');
  messagesList.innerHTML = ''; // Clear existing messages 

  // Sort messages by created_at before rendering
  messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    
  messages.forEach(msg => appendMessage(msg));

  // Scroll to bottom
  document.getElementById('messagesWrap').scrollTop = document.getElementById('messagesWrap').scrollHeight;
}

function appendMessage(msg) {
  // (The appendMessage function logic remains mostly the same, as it only handles DOM insertion)
  const messagesList = document.getElementById('messagesList');
  const listItem = tplMessage.content.firstElementChild.cloneNode(true);
  listItem.setAttribute('data-message-id', msg.id);

  // Find the profile for the user
  const profile = fullData.profiles.find(p => p.id === msg.user_id);
  const name = profile?.display_name || 'Unknown';
    
  // Populate content
  listItem.querySelector('.msg-author').textContent = name;
  listItem.querySelector('.msg-text').textContent = msg.body;
  listItem.querySelector('.msg-time').textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  listItem.querySelector('.msg-avatar').src = `https://via.placeholder.com/44?text=${name.charAt(0)}`; 

  messagesList.appendChild(listItem);
    
  // Scroll to bottom only if the list isn't manually scrolled up
  const messagesWrap = document.getElementById('messagesWrap');
  if (messagesWrap.scrollHeight - messagesWrap.scrollTop < messagesWrap.clientHeight + 100) {
      messagesWrap.scrollTop = messagesWrap.scrollHeight;
  }
}

// Send message (Uses updateFullData)
async function sendMessage(body) {
  if (!currentUser || !currentServer || !currentChannel) {
      return alert('Cannot send message. Server or user not selected.');
  }

  const newMessage = {
      id: `m-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
      body,
      server_id: currentServer.id,
      channel_id: currentChannel.id,
      user_id: currentUser.id,
      created_at: new Date().toISOString()
  };
  
  // 1. Add the new message to the local fullData
  fullData.messages.push(newMessage);
  
  // 2. Overwrite the entire bin (triggers update for other users via polling)
  const updated = await updateFullData(fullData);
  
  if (updated) {
      // 3. Immediately append the message to the sender's UI (no need to wait for poll)
      appendMessage(newMessage);
  } else {
      // If update failed, remove the message locally
      fullData.messages.pop();
  }
}
// app.js (Messaging and Data Persistence)

// Utility to send the updated fullData object back to JSONBIN
async function updateFullData(data) {
    try {
        const response = await fetch(JSONBIN_URL, {
            method: 'PUT',
            headers: PUT_HEADERS,
            body: JSON.stringify(data.record || data), // Ensure we send the record content
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        // Since we are writing, we immediately update our local version tracker
        lastDataVersion = result.metadata.version;
        
        console.log(`JSONBin updated successfully to version ${lastDataVersion}.`);
        return true;
    } catch (error) {
        console.error("Error updating JSONBin:", error);
        alert('Failed to send message/update data. Check console.');
        return false;
    }
}

// Handles the message form submission
async function sendMessage(event) {
    event.preventDefault();

    if (!currentUser || !currentServer || !currentChannel) {
        return alert('Please sign in and select a channel first.');
    }

    const messageInput = document.getElementById('messageInput');
    const body = messageInput.value.trim();

    if (!body) return;

    const newMessage = {
        id: `m-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`,
        body: body,
        server_id: currentServer.id,
        channel_id: currentChannel.id,
        user_id: currentUser.id,
        created_at: new Date().toISOString(),
    };

    // 1. Add message locally
    fullData.messages.push(newMessage);

    // 2. Append to the DOM immediately for a smooth experience
    appendMessage(newMessage);

    // 3. Send the entire updated object back to JSONBIN (PUT request)
    const success = await updateFullData(fullData);

    if (success) {
        messageInput.value = ''; // Clear input on success
        // Note: The polling logic will eventually detect this change 
        // in other clients and update their local fullData object.
    } else {
        // If save failed, remove the locally appended message
        fullData.messages.pop(); 
        document.getElementById('messagesList').lastElementChild.remove();
        // The user can try sending again
    }
}

// Add the event listener for the message form
document.addEventListener('DOMContentLoaded', () => {
    // Other initializations...
    
    // Attach the submit handler to the message form
    const messageForm = document.getElementById('messageForm');
    messageForm.addEventListener('submit', sendMessage);
    
    // This is the starting point, assuming you call guestLogin() or similar
    guestLogin("Guest User"); 
});

// ---------- Event Listeners (Remaining setupListeners is mostly unchanged) ----------
function setupListeners() {
  // Guest login button
  document.getElementById('signInBtn')?.addEventListener('click', () => guestLogin(prompt("Enter a display name:", "New Guest")))
  
  // Message Form Submission
  document.getElementById('messageForm')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const input = document.getElementById('messageInput')
    if (input?.value.trim()) {
      sendMessage(input.value.trim())
      input.value = '' 
    }
  })

  // Create Server Form Submission
  document.getElementById('createServerForm')?.addEventListener('submit', (e) => {
    e.preventDefault()
    const name = document.getElementById('newServerName').value.trim()
    const description = document.getElementById('newServerDesc').value.trim()
    const visibility = document.getElementById('newServerVisibility').value
    createServer(name, description, visibility)
  })

  // Modal close buttons
  document.querySelectorAll('.modal-close, .btn-flat[data-action="cancel"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
          e.target.closest('.modal')?.classList.add('hidden')
      })
  })

  // Modal open buttons
  document.getElementById('discoverBtn')?.addEventListener('click', () => document.getElementById('discoverModal').classList.remove('hidden'))
  document.getElementById('createServerBtn')?.addEventListener('click', () => document.getElementById('createServerModal').classList.remove('hidden'))
}


// ---------- Entry Point ----------
document.addEventListener('DOMContentLoaded', () => {
    setupListeners();
    // Start by logging in as a guest, which will trigger data initialization
    guestLogin("New Guest");
});
