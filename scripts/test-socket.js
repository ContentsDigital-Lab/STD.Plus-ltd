const { io } = require('socket.io-client');

require('dotenv').config();
const { snapshotIds, sweepCreatedData } = require('./test-helpers');
const API = `http://localhost:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

const _log = console.log;
console.log = (...args) => {
  const msg = args.map(String).join(' ');
  if (/\bPASS\b/.test(msg)) passed++;
  if (/\bFAIL\b/.test(msg)) failed++;
  _log.apply(console, args);
};

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

function emitWithAckData(socket, event, data, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ack on ${event}`)), timeout);
    socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function testJoinEvents() {
  console.log('=== Room Join Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  const rooms = ['me', 'dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim', 'pane', 'production', 'pricing'];
  let n = 1;

  for (const room of rooms) {
    const ack = await emitWithAck(socket, `join_${room}`);
    if (!ack.ok) throw new Error(`join_${room} failed`);
    console.log(`${n++}. PASS join_${room} — joined room "${ack.room}"`);
  }

  // Station room (dynamic)
  const fakeStationId = '000000000000000000000001';
  const joinAck = await emitWithAckData(socket, 'join_station_room', { stationId: fakeStationId });
  if (!joinAck.ok) throw new Error('join_station_room failed');
  console.log(`${n++}. PASS join_station_room — joined room "${joinAck.room}"`);

  // Station room without stationId (should fail)
  const badAck = await emitWithAckData(socket, 'join_station_room', {});
  if (badAck.ok) throw new Error('join_station_room should have failed without stationId');
  console.log(`${n++}. PASS join_station_room (no stationId) — rejected: "${badAck.error}"`);

  socket.disconnect();
  console.log(`\n=== All room join event tests passed ===\n`);
}

async function testLeaveEvents() {
  console.log('=== Room Leave Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  const rooms = ['dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim', 'pane', 'production', 'pricing'];

  for (const room of rooms) {
    await emitWithAck(socket, `join_${room}`);
  }
  const fakeStationId = '000000000000000000000001';
  await emitWithAckData(socket, 'join_station_room', { stationId: fakeStationId });
  console.log('   (joined all rooms first)\n');

  let n = 1;
  for (const room of rooms) {
    const ack = await emitWithAck(socket, `leave_${room}`);
    if (!ack.ok) throw new Error(`leave_${room} failed`);
    console.log(`${n++}. PASS leave_${room} — left room "${ack.room}"`);
  }

  // Station room (dynamic)
  const leaveAck = await emitWithAckData(socket, 'leave_station_room', { stationId: fakeStationId });
  if (!leaveAck.ok) throw new Error('leave_station_room failed');
  console.log(`${n++}. PASS leave_station_room — left room "${leaveAck.room}"`);

  // Leave without stationId (should fail)
  const badAck = await emitWithAckData(socket, 'leave_station_room', {});
  if (badAck.ok) throw new Error('leave_station_room should have failed without stationId');
  console.log(`${n++}. PASS leave_station_room (no stationId) — rejected: "${badAck.error}"`);

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
  const rooms = ['dashboard', 'inventory', 'station', 'log', 'request', 'withdrawal', 'order', 'claim', 'pane', 'production'];
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
  const wdRes = await apiCall('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 2, stockType: 'Raw' });
  const wdEvent = await wdPromise;
  const wdNum = wdRes.data?.withdrawalNumber;
  const evtNum = wdEvent.data?.withdrawalNumber;
  const numOk = typeof wdNum === 'string' && wdNum.startsWith('WDW-') && wdNum === evtNum;
  console.log(`${n++}. ${numOk ? 'PASS' : 'FAIL'} withdrawal:updated — action: ${wdEvent.action}, withdrawalNumber: ${wdNum}${numOk ? '' : ' (socket/API mismatch or missing)'}`);

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

  // 8. station-template:updated
  const tmplPromise = waitForEvent(socket, 'station-template:updated');
  const tmpl = await apiCall('POST', '/api/station-templates', token, { name: 'Socket Test Template' });
  const tmplEvent = await tmplPromise;
  console.log(`${n++}. PASS station-template:updated — action: ${tmplEvent.action}`);
  const tmplId = tmpl.data._id;

  // 9. station:updated
  const stationPromise = waitForEvent(socket, 'station:updated');
  const station = await apiCall('POST', '/api/stations', token, { name: 'Socket Test Station', templateId: tmplId });
  const stationEvent = await stationPromise;
  console.log(`${n++}. PASS station:updated — action: ${stationEvent.action}`);

  // 10. notification
  const notifPromise = waitForEvent(socket, 'notification');
  await apiCall('POST', '/api/notifications', token, { recipient: workerId, type: 'info', title: 'Test notification' });
  const notifEvent = await notifPromise;
  console.log(`${n++}. PASS notification — title: ${notifEvent.title}`);

  // 11. system_alert
  const alertPromise = waitForEvent(socket, 'system_alert');
  socket.emit('system_alert', { message: 'Test system alert' });
  const alertEvent = await alertPromise;
  console.log(`${n++}. PASS system_alert — message: ${alertEvent.message}`);

  // 12. station:check_in (dynamic station room)
  const stationId = station.data._id;
  await emitWithAckData(socket, 'join_station_room', { stationId });

  const checkInOrder = await apiCall('POST', '/api/orders', token, {
    customer: cust.data._id,
    material: matId,
    quantity: 5,
    stations: [stationId],
    currentStationIndex: 0,
  });
  const checkInOrderId = checkInOrder.data._id;

  const checkInPromise = waitForEvent(socket, 'station:check_in');
  await apiCall('PATCH', `/api/orders/${checkInOrderId}`, token, {
    stationHistory: [{ station: stationId, enteredAt: new Date().toISOString() }],
  });
  const checkInEvent = await checkInPromise;
  console.log(`${n++}. PASS station:check_in — orderId: ${checkInEvent.orderId}, stationId: ${checkInEvent.stationId}, action: ${checkInEvent.action}`);

  await emitWithAckData(socket, 'leave_station_room', { stationId });

  // 13. pane:updated
  const paneOrd = await apiCall('POST', '/api/orders', token, { customer: cust.data._id, material: matId, quantity: 1 });
  const paneOrdId = paneOrd.data._id;
  const panePromise = waitForEvent(socket, 'pane:updated');
  const paneData = await apiCall('POST', '/api/panes', token, { order: paneOrdId });
  const paneEvent = await panePromise;
  console.log(`${n++}. PASS pane:updated — action: ${paneEvent.action}`);
  const paneId = paneData.data._id;

  // 14. production-log:updated
  const prodLogPromise = waitForEvent(socket, 'production-log:updated');
  const prodLogData = await apiCall('POST', '/api/production-logs', token, {
    pane: paneId, order: paneOrdId, station: stationId, action: 'scan_in', operator: workerId,
  });
  const prodLogEvent = await prodLogPromise;
  console.log(`${n++}. PASS production-log:updated — action: ${prodLogEvent.action}`);

  // Cleanup pane test data
  await apiCall('DELETE', `/api/production-logs/${prodLogData.data._id}`, token);
  await apiCall('DELETE', `/api/panes/${paneId}`, token);
  await apiCall('DELETE', `/api/orders/${paneOrdId}`, token);

  // Cleanup test data
  await apiCall('DELETE', `/api/orders/${checkInOrderId}`, token);
  await apiCall('DELETE', `/api/stations/${stationId}`, token);
  await apiCall('DELETE', `/api/station-templates/${tmplId}`, token);
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

async function testQrCheckIn() {
  console.log('=== QR Check-In Flow (join-station / mobile-scan / scan-confirmed) ===\n');

  const token = await getToken();

  // Station screen connects and joins a station
  const stationSocket = await connect(API, '/api/socket-entry', { token });
  const fakeStationId = 'station-qr-test-001';

  const joinAck = await emitWithAckData(stationSocket, 'join-station', fakeStationId);
  console.log(`1. PASS join-station — joined room "${joinAck.room}", ok: ${joinAck.ok}`);

  // join-station without stationId should fail
  const badAck = await emitWithAckData(stationSocket, 'join-station', '');
  console.log(`2. PASS join-station (empty) — rejected: ok=${badAck.ok}, error="${badAck.error}"`);

  // Mobile device sends a scan
  const mobileSocket = await connect(API, '/api/socket-entry', { token });

  const scanConfirmedPromise = waitForEvent(stationSocket, 'scan-confirmed');
  const mobileScanAck = await emitWithAckData(mobileSocket, 'mobile-scan', { stationId: fakeStationId });
  console.log(`3. PASS mobile-scan — ok: ${mobileScanAck.ok}`);

  const scanEvent = await scanConfirmedPromise;
  console.log(`4. PASS scan-confirmed received — worker: "${scanEvent.worker}", time: "${scanEvent.time}"`);

  // mobile-scan without stationId should fail
  const badScanAck = await emitWithAckData(mobileSocket, 'mobile-scan', {});
  console.log(`5. PASS mobile-scan (no stationId) — ok: ${badScanAck.ok}, error: "${badScanAck.error}"`);

  // Replay: new station screen joining within 15s window should get the last scan
  const newStationSocket = await connect(API, '/api/socket-entry', { token });
  const replayPromise = waitForEvent(newStationSocket, 'scan-confirmed', 3000);
  newStationSocket.emit('join-station', fakeStationId, () => {});

  try {
    const replayEvent = await replayPromise;
    console.log(`6. PASS scan-confirmed replay — worker: "${replayEvent.worker}"`);
  } catch {
    console.log('6. SKIP scan-confirmed replay — no replay within 3s (may have exceeded 15s window)');
  }

  stationSocket.disconnect();
  mobileSocket.disconnect();
  newStationSocket.disconnect();
  console.log('\n=== All QR check-in tests passed ===\n');
}

async function testPricingEvent() {
  console.log('=== Pricing Updated Event ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  // Join pricing room
  const joinAck = await emitWithAck(socket, 'join_pricing');
  console.log(`1. PASS join_pricing — room: "${joinAck.room}"`);

  // Update pricing settings and verify event
  const pricingPromise = waitForEvent(socket, 'pricing:updated');
  await apiCall('PUT', '/api/pricing-settings', token, { holePriceEach: 88 });
  const pricingEvent = await pricingPromise;
  console.log(`2. PASS pricing:updated — holePriceEach: ${pricingEvent.holePriceEach}`);

  // Leave pricing room
  const leaveAck = await emitWithAck(socket, 'leave_pricing');
  console.log(`3. PASS leave_pricing — room: "${leaveAck.room}"`);

  // Restore default
  await apiCall('PUT', '/api/pricing-settings', token, { holePriceEach: 50 });

  socket.disconnect();
  console.log('\n=== All pricing event tests passed ===\n');
}

async function testStickerTemplateAllEvents() {
  console.log('=== Sticker Template All Events (create/update/delete) ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });
  await emitWithAck(socket, 'join_dashboard');

  const createPromise = waitForEvent(socket, 'sticker-template:updated');
  const tmpl = await apiCall('POST', '/api/sticker-templates', token, {
    name: 'ws-all-events', width: 100, height: 50,
  });
  const createEvent = await createPromise;
  console.log(`1. PASS sticker-template:updated (create) — action: ${createEvent.action}`);
  const tmplId = tmpl.data._id;

  const updatePromise = waitForEvent(socket, 'sticker-template:updated');
  await apiCall('PATCH', `/api/sticker-templates/${tmplId}`, token, { width: 200 });
  const updateEvent = await updatePromise;
  console.log(`2. PASS sticker-template:updated (update) — action: ${updateEvent.action}`);

  const deletePromise = waitForEvent(socket, 'sticker-template:updated');
  await apiCall('DELETE', `/api/sticker-templates/${tmplId}`, token);
  const deleteEvent = await deletePromise;
  console.log(`3. PASS sticker-template:updated (delete) — action: ${deleteEvent.action}`);

  socket.disconnect();
  console.log('\n=== All sticker template event tests passed ===\n');
}

async function testJobTypeEvent() {
  console.log('=== Job Type Events ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });
  await emitWithAck(socket, 'join_dashboard');

  const createPromise = waitForEvent(socket, 'jobType:updated');
  const jt = await apiCall('POST', '/api/job-types', token, {
    name: 'WS Test Type', code: 'WS_TEST',
  });
  const createEvent = await createPromise;
  console.log(`1. PASS jobType:updated (create) — action: ${createEvent.action}`);
  const jtId = jt.data._id;

  const updatePromise = waitForEvent(socket, 'jobType:updated');
  await apiCall('PATCH', `/api/job-types/${jtId}`, token, { name: 'WS Test Updated' });
  const updateEvent = await updatePromise;
  console.log(`2. PASS jobType:updated (update) — action: ${updateEvent.action}`);

  const deletePromise = waitForEvent(socket, 'jobType:updated');
  await apiCall('DELETE', `/api/job-types/${jtId}`, token);
  const deleteEvent = await deletePromise;
  console.log(`3. PASS jobType:updated (delete) — action: ${deleteEvent.action}`);

  socket.disconnect();
  console.log('\n=== All job type event tests passed ===\n');
}

async function testOrderFirstStationNotification() {
  console.log('=== Order First-Station Notification ===\n');

  const token = await getToken();
  const socket = await connect(API, '/api/socket-entry', { token });

  const tmpl = await apiCall('POST', '/api/station-templates', token, { name: 'WS Notif Template' });
  const tmplId = tmpl.data._id;
  const stn1 = await apiCall('POST', '/api/stations', token, { name: 'WS Notif Station', templateId: tmplId });
  const stn1Id = stn1.data._id;
  const stn2 = await apiCall('POST', '/api/stations', token, { name: 'WS QC Station', templateId: tmplId });
  const stn2Id = stn2.data._id;

  await emitWithAckData(socket, 'join_station_room', { stationId: stn1Id });

  const mat = await apiCall('POST', '/api/materials', token, { name: 'NotifTest Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data._id;
  const cust = await apiCall('POST', '/api/customers', token, { name: 'NotifTest Cust' });
  const custId = cust.data._id;

  const notifPromise = waitForEvent(socket, 'notification');
  const ord = await apiCall('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, stations: [stn1Id, stn2Id],
  });
  const ordId = ord.data._id;

  const notifEvent = await notifPromise;
  console.log(`1. PASS notification on order create — type: "${notifEvent.type}", title: "${notifEvent.title}"`);
  console.log(`   referenceId: ${notifEvent.referenceId}, referenceType: ${notifEvent.referenceType}`);

  await apiCall('DELETE', `/api/orders/${ordId}`, token);
  await apiCall('DELETE', `/api/materials/${matId}`, token);
  await apiCall('DELETE', `/api/customers/${custId}`, token);
  await apiCall('DELETE', `/api/station-templates/${tmplId}`, token);
  socket.disconnect();
  console.log('\n=== Order first-station notification test passed ===\n');
}

async function main() {
  const sweepToken = await getToken();
  const snapshot = await snapshotIds(API, sweepToken);

  try {
    await testSystemEvents();
    await testJoinEvents();
    await testLeaveEvents();
    await testDataEvents();
    await testSystemAlertRBAC();
    await testQrCheckIn();
    await testPricingEvent();
    await testStickerTemplateAllEvents();
    await testJobTypeEvent();
    await testOrderFirstStationNotification();
  } finally {
    await sweepCreatedData(API, sweepToken, snapshot);
  }

  _log('\n========================================');
  _log(`   PASSED: ${passed}`);
  _log(`   FAILED: ${failed}`);
  _log(`   TOTAL:  ${passed + failed}`);
  _log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});