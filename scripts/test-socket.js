const { io } = require('socket.io-client');

const API = 'http://localhost:3000';

async function getToken() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  const data = await res.json();
  return data.data.token;
}

async function main() {
  console.log('1. Logging in...');
  const token = await getToken();
  console.log(`   Token: ${token.slice(0, 30)}...`);

  console.log('\n2. Connecting to WebSocket...');
  const socket = io(API, {
    path: '/api/socket-entry',
    auth: { token },
  });

  socket.on('connect', () => {
    console.log(`   Connected! Socket ID: ${socket.id}`);
    console.log('\n3. Listening for events... (press Ctrl+C to exit)\n');
  });

  socket.on('connect_error', (err) => {
    console.error(`   Connection failed: ${err.message}`);
    process.exit(1);
  });

  socket.on('disconnect', (reason) => {
    console.log(`   Disconnected: ${reason}`);
  });

  socket.onAny((event, ...args) => {
    console.log(`   [event] ${event}:`, JSON.stringify(args, null, 2));
  });
}

main();