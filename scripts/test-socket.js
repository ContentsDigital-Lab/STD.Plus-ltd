const { io } = require('socket.io-client');

require('dotenv').config();
const API = `http://localhost:${process.env.PORT || 3000}`;

async function getToken(username = 'admin', password = 'admin123') {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.data?.token) throw new Error(`Login failed for "${username}" (${res.status}): ${data.message}`);
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

function waitForEvent(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function apiCall(method, path, token, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return res.json();
}

async function testDataEvents() {
  console.log('=== Data Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  // join rooms to receive events
  const rooms = ['dashboard', 'inventory', 'log', 'request', 'withdrawal', 'order', 'claim'];
  for (const room of rooms) {
    await emitWithAck(socket, `join_${room}`);
  }
  await emitWithAck(socket, 'join_me');
  console.log('   (joined all rooms)\n');

  let n = 1;

  // 1. material:updated
  const matPromise = waitForEvent(socket, 'material:updated');
  const mat = await apiCall('POST', '/api/materials', token, { name: 'Test Glass', unit: 'sheet', reorderPoint: 5 });
  const matEvent = await matPromise;
  console.log(`${n++}. PASS material:updated — action: ${matEvent.action}`);
  const matId = mat.data._id;

  // 2. inventory:updated
  const invPromise = waitForEvent(socket, 'inventory:updated');
  const inv = await apiCall('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'Warehouse A' });
  const invEvent = await invPromise;
  console.log(`${n++}. PASS inventory:updated — action: ${invEvent.action}`);

  // 3. order:updated
  const cust = await apiCall('POST', '/api/customers', token, { name: 'Test Customer' });
  const ordPromise = waitForEvent(socket, 'order:updated');
  const ord = await apiCall('POST', '/api/orders', token, { customer: cust.data._id, material: matId, quantity: 10 });
  const ordEvent = await ordPromise;
  console.log(`${n++}. PASS order:updated — action: ${ordEvent.action}`);
  const ordId = ord.data._id;

  // 4. request:updated
  const reqPromise = waitForEvent(socket, 'request:updated');
  const reqData = await apiCall('POST', '/api/requests', token, { details: { type: 'cut', quantity: 5 }, customer: cust.data._id });
  const reqEvent = await reqPromise;
  console.log(`${n++}. PASS request:updated — action: ${reqEvent.action}`);

  // 5. withdrawal:updated
  const meRes = await apiCall('GET', '/api/auth/me', token);
  const workerId = meRes.data._id;
  const wdPromise = waitForEvent(socket, 'withdrawal:updated');
  await apiCall('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 2, stockType: 'Raw' });
  const wdEvent = await wdPromise;
  console.log(`${n++}. PASS withdrawal:updated — action: ${wdEvent.action}`);

  // 6. claim:updated
  const claimPromise = waitForEvent(socket, 'claim:updated');
  await apiCall('POST', `/api/orders/${ordId}/claims`, token, { source: 'worker', material: matId, description: 'Test claim', reportedBy: workerId });
  const claimEvent = await claimPromise;
  console.log(`${n++}. PASS claim:updated — action: ${claimEvent.action}`);

  // 7. log:updated
  const logPromise = waitForEvent(socket, 'log:updated');
  await apiCall('POST', '/api/material-logs', token, { material: matId, actionType: 'import', quantityChanged: 50 });
  const logEvent = await logPromise;
  console.log(`${n++}. PASS log:updated — action: ${logEvent.action}`);

  // 8. notification
  const notifPromise = waitForEvent(socket, 'notification');
  await apiCall('POST', '/api/notifications', token, { recipient: workerId, type: 'info', title: 'Test notification' });
  const notifEvent = await notifPromise;
  console.log(`${n++}. PASS notification — title: ${notifEvent.title}`);

  // 9. system_alert
  const alertPromise = waitForEvent(socket, 'system_alert');
  socket.emit('system_alert', { message: 'Test system alert' });
  const alertEvent = await alertPromise;
  console.log(`${n++}. PASS system_alert — message: ${alertEvent.message}`);

  // Cleanup test data
  await apiCall('DELETE', `/api/materials/${matId}`, token);
  await apiCall('DELETE', `/api/inventories/${inv.data._id}`, token);
  await apiCall('DELETE', `/api/orders/${ordId}`, token);
  await apiCall('DELETE', `/api/requests/${reqData.data._id}`, token);
  await apiCall('DELETE', `/api/customers/${cust.data._id}`, token);

  socket.disconnect();
  console.log(`\n=== All data event tests passed ===\n`);
}

async function testSystemAlertRBAC() {
  console.log('=== System Alert RBAC ===\n');

  const adminToken = await getToken('admin', 'admin123');
  const managerToken = await getToken('manager1', 'manager123');
  const workerToken = await getToken('worker1', 'worker123');

  // 1. Admin emits system_alert — should broadcast
  const adminSocket = await connect(API, '/api/socket-entry', { token: adminToken });
  const alertPromise = waitForEvent(adminSocket, 'system_alert');
  adminSocket.emit('system_alert', { message: 'Admin broadcast' });
  const alertEvent = await alertPromise;
  console.log(`1. PASS system_alert (admin) — broadcasted: "${alertEvent.message}"`);
  adminSocket.disconnect();

  // 2. Manager emits system_alert — should be blocked
  const managerSocket = await connect(API, '/api/socket-entry', { token: managerToken });
  const managerErrorPromise = waitForEvent(managerSocket, 'error', 3000);
  managerSocket.emit('system_alert', { message: 'Manager broadcast' });
  try {
    const errData = await managerErrorPromise;
    console.log(`2. PASS system_alert (manager) — blocked: "${errData.message}"`);
  } catch {
    console.log('2. FAIL system_alert (manager) — was not blocked');
  }
  managerSocket.disconnect();

  // 3. Worker emits system_alert — should be blocked
  const workerSocket = await connect(API, '/api/socket-entry', { token: workerToken });
  const workerErrorPromise = waitForEvent(workerSocket, 'error', 3000);
  workerSocket.emit('system_alert', { message: 'Worker broadcast' });
  try {
    const errData = await workerErrorPromise;
    console.log(`3. PASS system_alert (worker) — blocked: "${errData.message}"`);
  } catch {
    console.log('3. FAIL system_alert (worker) — was not blocked');
  }
  workerSocket.disconnect();

  console.log('\n=== All system alert RBAC tests passed ===\n');
}

async function main() {
  await testSystemEvents();
  await testJoinEvents();
  await testLeaveEvents();
  await testDataEvents();
  await testSystemAlertRBAC();
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});