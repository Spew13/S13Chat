const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve front-end files

// Initialize or load global servers/messages
const DATA_FILE = 'data.json';
let data = { servers: {} };

if (fs.existsSync(DATA_FILE)) {
  data = JSON.parse(fs.readFileSync(DATA_FILE));
}

// ---- Routes ---- //

// Get all servers/messages
app.get('/data', (req, res) => {
  res.json(data);
});

// Create a server (optional, front-end can also handle automatically)
app.post('/server', (req, res) => {
  const { server } = req.body;
  if (!server) return res.status(400).json({ error: 'Server name required' });
  if (!data.servers[server]) data.servers[server] = { messages: [] };
  saveData();
  res.json({ success: true });
});

// Add a message
app.post('/message', (req, res) => {
  const { server, username, text } = req.body;
  if (!server || !username || !text) return res.status(400).json({ error: 'Missing fields' });

  if (!data.servers[server]) data.servers[server] = { messages: [] };

  data.servers[server].messages.push({ username, text, time: new Date().toISOString() });
  saveData();
  res.json({ success: true });
});

// ---- Helper ---- //
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---- Start server ---- //
app.listen(PORT, () => {
  console.log(`S13Chat backend running on port ${PORT}`);
});
