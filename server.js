import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import apiRouter from './src/routes/api.js';
import { handleWebSocket } from './src/claude-bridge.js';

config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const PORT = process.env.PORT || 3333;

// Middleware
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// API routes
app.use('/api', apiRouter);

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// WebSocket
wss.on('connection', (ws, req) => {
  console.log('[ws] Client connected');
  handleWebSocket(ws);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⚡ Claude Web Remote`);
  console.log(`  → Local:   http://localhost:${PORT}`);
  console.log(`  → Network: http://0.0.0.0:${PORT}\n`);
});
