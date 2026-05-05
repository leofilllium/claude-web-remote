import { spawn } from 'child_process';
import { config } from 'dotenv';

config();

const PORT = process.env.PORT || 3333;

// ── Start the app server ────────────────────────────────────
const server = spawn('node', ['server.js'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
  env: { ...process.env },
});

// Give server a moment to bind the port
await new Promise((r) => setTimeout(r, 1500));

// ── Start Cloudflare Tunnel ─────────────────────────────────
console.log('\n  🚇 Starting Cloudflare Tunnel…\n');

const tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});

let tunnelUrl = null;

function parseTunnelUrl(text) {
  // cloudflared prints the URL to stderr
  const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (match && !tunnelUrl) {
    tunnelUrl = match[0];
    console.log(`  ╔══════════════════════════════════════════════════╗`);
    console.log(`  ║  📱 Remote Access URL:                          ║`);
    console.log(`  ║  ${tunnelUrl.padEnd(48)}║`);
    console.log(`  ╚══════════════════════════════════════════════════╝\n`);
    if (process.env.TUNNEL_AUTH_USER && process.env.TUNNEL_AUTH_PASS) {
      console.log(`  🔐 Basic auth enabled — user: ${process.env.TUNNEL_AUTH_USER}\n`);
    } else {
      console.log(`  ⚠️  No auth configured! Set TUNNEL_AUTH_USER & TUNNEL_AUTH_PASS in .env\n`);
    }
  }
}

tunnel.stdout.on('data', (d) => {
  const text = d.toString();
  parseTunnelUrl(text);
});

tunnel.stderr.on('data', (d) => {
  const text = d.toString();
  parseTunnelUrl(text);
  // Only log actual errors, not info lines
  if (text.toLowerCase().includes('error') || text.toLowerCase().includes('failed')) {
    console.error(`  [tunnel] ${text.trim()}`);
  }
});

tunnel.on('error', (err) => {
  console.error('\n  ❌ Failed to start cloudflared. Install it first:');
  console.error('     brew install cloudflared\n');
  server.kill();
  process.exit(1);
});

// ── Graceful shutdown ───────────────────────────────────────
function cleanup() {
  console.log('\n  Shutting down…');
  tunnel.kill();
  server.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

server.on('close', (code) => {
  console.log(`  Server exited (${code})`);
  tunnel.kill();
  process.exit(code);
});

tunnel.on('close', (code) => {
  console.log(`  Tunnel exited (${code})`);
  server.kill();
  process.exit(code);
});
