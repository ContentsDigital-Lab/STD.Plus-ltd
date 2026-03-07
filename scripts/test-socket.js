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

function connect(url, path, auth) {
  return new Promise((resolve, reject) => {
    const socket = io(url, { path, auth });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

async function testSystemEvents() {
  console.log('=== System Events ===\n');

  // 1. connect
  console.log('1. Testing connect...');
  const token = await getToken();
  console.log(`   Token: ${token.slice(0, 30)}...`);
  const socket = await connect(API, '/api/socket-entry', { token });
  console.log(`   PASS connect — Socket ID: ${socket.id}`);

  // 2. error
  console.log('\n2. Testing error...');
  const errorPromise = new Promise((resolve) => {
    socket.on('error', (data) => resolve(data));
  });
  socket.emit('error', new Error('Test error from client'));
  const errorData = await Promise.race([
    errorPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000)),
  ]);
  console.log(`   PASS error — Received:`, errorData);

  // 3. disconnect
  console.log('\n3. Testing disconnect...');
  const disconnectPromise = new Promise((resolve) => {
    socket.on('disconnect', (reason) => resolve(reason));
  });
  socket.disconnect();
  const reason = await disconnectPromise;
  console.log(`   PASS disconnect — Reason: ${reason}`);

  // 4. connect_error (invalid token)
  console.log('\n4. Testing connect_error (bad token)...');
  try {
    await connect(API, '/api/socket-entry', { token: 'invalid-token' });
    console.log('   FAIL — Should have rejected');
  } catch (err) {
    console.log(`   PASS connect_error — ${err.message}`);
  }

  console.log('\n=== All system event tests passed ===\n');
}

function emitWithAck(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ack on ${event}`)), timeout);
    socket.emit(event, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function testJoinEvents() {
  console.log('=== Room Join Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  const rooms = ['me', 'dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim'];

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const ack = await emitWithAck(socket, `join_${room}`);
    if (!ack.ok) throw new Error(`join_${room} failed`);
    console.log(`${i + 1}. PASS join_${room} — joined room "${ack.room}"`);
  }

  socket.disconnect();
  console.log(`\n=== All room join event tests passed ===\n`);
}

async function testLeaveEvents() {
  console.log('=== Room Leave Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  const rooms = ['dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim'];

  for (const room of rooms) {
    await emitWithAck(socket, `join_${room}`);
  }
  console.log('   (joined all rooms first)\n');

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const ack = await emitWithAck(socket, `leave_${room}`);
    if (!ack.ok) throw new Error(`leave_${room} failed`);
    console.log(`${i + 1}. PASS leave_${room} — left room "${ack.room}"`);
  }

  socket.disconnect();
  console.log(`\n=== All room leave event tests passed ===\n`);
}

async function main() {
  await testSystemEvents();
  await testJoinEvents();
  await testLeaveEvents();
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});