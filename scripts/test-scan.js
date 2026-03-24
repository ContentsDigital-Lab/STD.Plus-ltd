require('dotenv').config();
const { io } = require('socket.io-client');
const API = `http://localhost:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

async function api(method, path, token, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function login(username, password) {
  const res = await api('POST', '/api/auth/login', null, { username, password });
  if (!res.data.data?.token) {
    throw new Error(`Login failed for "${username}" (${res.status}): ${res.data.message}`);
  }
  return res.data.data.token;
}

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`   PASS  ${label} — ${actual}`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

function checkIncludes(label, str, substring) {
  if (str && str.includes(substring)) {
    console.log(`   PASS  ${label} — "${str}"`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — expected to include "${substring}", got "${str}"`);
    failed++;
  }
}

function connectSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { path: '/api/socket-entry', auth: { token } });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function emitWithAck(socket, event, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout on ${event}`)), timeout);
    socket.emit(event, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
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

// ──────────────────────────────────────────────
// 1. BASIC SCAN FLOW
// ──────────────────────────────────────────────

async function testBasicScanFlow(token) {
  console.log('\n=== Basic Scan Flow ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Scan Test Customer' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Scan Test Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = ['cutting', 'edging', 'qc'];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 2 },
    panes: [
      { routing, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered' },
      { routing, dimensions: { width: 1000, height: 500, thickness: 6 }, glassType: 'laminated' },
    ],
  });
  check('CREATE request with panes', reqRes.status, 201);
  const reqId = reqRes.data.data._id;

  const pane1 = reqRes.data.data.panes[0];
  const pane2 = reqRes.data.data.panes[1];
  check('  pane 1 has paneNumber', !!pane1.paneNumber, true);
  check('  pane 2 has paneNumber', !!pane2.paneNumber, true);
  console.log(`          pane 1: ${pane1.paneNumber}, pane 2: ${pane2.paneNumber}`);

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 2,
    request: reqId,
    paneCount: 2,
    assignedTo: workerId,
    stations: routing,
  });
  check('CREATE order from request', ordRes.status, 201);
  const ordId = ordRes.data.data._id;

  // Verify panes got order backfilled
  const pane1Get = await api('GET', `/api/panes/${pane1._id}`, token);
  check('  pane 1 order backfilled', !!pane1Get.data.data.order, true);

  // ── verify pane starts at first routing station (cutting) ──
  check('  pane 1 starts at routing[0]', pane1.currentStation, 'cutting');

  // ── scan_in at cutting ──
  const r1 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_in',
  });
  check('SCAN_IN pane 1 at cutting', r1.status, 200);
  check('  pane still at cutting', r1.data.data.pane.currentStation, 'cutting');
  check('  startedAt is set', !!r1.data.data.pane.startedAt, true);
  check('  production log created', !!r1.data.data.log, true);
  check('  log action is scan_in', r1.data.data.log.action, 'scan_in');

  // ── start at cutting ──
  const r3 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'start',
  });
  check('START pane 1 at cutting', r3.status, 200);
  check('  status is in_progress', r3.data.data.pane.currentStatus, 'in_progress');

  // ── complete at cutting → awaiting_scan_out (stays at cutting) ──
  const r4 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'complete',
  });
  check('COMPLETE pane 1 at cutting', r4.status, 200);
  check('  pane stays at cutting', r4.data.data.pane.currentStation, 'cutting');
  check('  status is awaiting_scan_out', r4.data.data.pane.currentStatus, 'awaiting_scan_out');

  // ── scan_out at cutting → moves to edging ──
  const r4b = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at cutting', r4b.status, 200);
  check('  pane moved to edging', r4b.data.data.pane.currentStation, 'edging');
  check('  nextStation is edging', r4b.data.data.nextStation, 'edging');
  check('  status is pending', r4b.data.data.pane.currentStatus, 'pending');

  // ── complete + scan_out at edging → moves to qc ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'edging', action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'edging', action: 'complete' });
  const r5 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'edging', action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at edging', r5.status, 200);
  check('  pane moved to qc', r5.data.data.pane.currentStation, 'qc');

  // ── complete + scan_out at qc (last station) → completed ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'qc', action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  const r6 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'qc', action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at qc (last)', r6.status, 200);
  check('  pane stays at qc', r6.data.data.pane.currentStation, 'qc');
  check('  status is completed', r6.data.data.pane.currentStatus, 'completed');
  check('  completedAt is set', !!r6.data.data.pane.completedAt, true);

  // ── verify order progress ──
  const ordAfter = await api('GET', `/api/orders/${ordId}`, token);
  check('  order panesCompleted', ordAfter.data.data.panesCompleted, 1);
  check('  order progressPercent', ordAfter.data.data.progressPercent, 50);
  check('  order status still in progress', ordAfter.data.data.status !== 'completed', true);

  // ── complete pane 2 through all stations (complete + scan_out at each) ──
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'edging', action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'edging', action: 'scan_out' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  const r7 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });
  check('SCAN_OUT pane 2 through all stations', r7.status, 200);
  check('  pane 2 completed', r7.data.data.pane.currentStatus, 'completed');

  // ── verify order fully completed ──
  const ordFinal = await api('GET', `/api/orders/${ordId}`, token);
  check('  order panesCompleted', ordFinal.data.data.panesCompleted, 2);
  check('  order progressPercent', ordFinal.data.data.progressPercent, 100);
  check('  order status completed', ordFinal.data.data.status, 'completed');

  // ── cleanup notifications created by scan ──
  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) => n.type === 'pane_arrived');
  if (scanNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: scanNotifs.map((n) => n._id) });
  }

  // ── cleanup production logs ──
  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) =>
    [pane1._id, pane2._id].includes(l.pane?._id || l.pane)
  );
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  await api('DELETE', `/api/panes/${pane1._id}`, token);
  await api('DELETE', `/api/panes/${pane2._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 2. ERROR CASES
// ──────────────────────────────────────────────

async function testErrorCases(token) {
  console.log('\n=== Scan Error Cases ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Scan Error Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Scan Error Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [{ routing: ['cutting', 'qc'], glassType: 'tempered' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1,
  });
  const ordId = ordRes.data.data._id;

  // ── non-existent pane ──
  const r1 = await api('POST', '/api/panes/PNE-9999/scan', token, {
    station: 'cutting', action: 'complete',
  });
  check('scan non-existent pane', r1.status, 404);

  // ── wrong station (pane starts at cutting, try edging) ──
  const r2 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: 'edging', action: 'complete',
  });
  check('complete at wrong station', r2.status, 400);
  checkIncludes('  message mentions actual station', r2.data.message, 'cutting');

  // ── scan_out without complete first ──
  const r2b = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('scan_out without complete first', r2b.status, 400);
  checkIncludes('  message says must complete first', r2b.data.message, 'เสร็จสิ้น');

  // ── complete + scan_out through all stations, then try again ──
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });

  const r3 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: 'qc', action: 'complete',
  });
  check('scan already completed pane', r3.status, 400);
  checkIncludes('  message says already completed', r3.data.message, 'already completed');

  // ── invalid action ──
  const r4 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: 'qc', action: 'invalid_action',
  });
  check('scan with invalid action', r4.status, 400);

  // ── pane number from QR code (frontend strips STDPLUS: prefix and sends just PNE-XXXX) ──
  const reqRes2 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: ['cutting'] }],
  });
  const reqId2 = reqRes2.data.data._id;
  const pane2 = reqRes2.data.data.panes[0];

  const ordRes2 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId2, paneCount: 1,
  });
  const ordId2 = ordRes2.data.data._id;

  const qrValue = pane2.qrCode;
  check('QR code has STDPLUS: prefix', qrValue.startsWith('STDPLUS:'), true);
  const parsedPaneNumber = qrValue.replace('STDPLUS:', '');

  const r5 = await api('POST', `/api/panes/${parsedPaneNumber}/scan`, token, {
    station: 'cutting', action: 'complete',
  });
  check('scan with pane number parsed from QR', r5.status, 200);
  check('  pane awaiting scan_out', r5.data.data.pane.currentStatus, 'awaiting_scan_out');

  const r5b = await api('POST', `/api/panes/${parsedPaneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('scan_out with QR parsed pane', r5b.status, 200);
  check('  pane completed (single station)', r5b.data.data.pane.currentStatus, 'completed');

  // ── no routing — pane starts at ready and is already completed ──
  const reqRes3 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: [] }],
  });
  const reqId3 = reqRes3.data.data._id;
  const pane3 = reqRes3.data.data.panes[0];
  check('empty routing pane starts at ready', pane3.currentStation, 'ready');
  check('  empty routing pane is completed', pane3.currentStatus, 'completed');

  const ordRes3 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId3, paneCount: 1,
  });
  const ordId3 = ordRes3.data.data._id;

  const r6 = await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, {
    station: 'ready', action: 'complete',
  });
  check('scan already-completed empty-routing pane', r6.status, 400);
  checkIncludes('  says already completed', r6.data.message, 'already completed');

  // ── cleanup ──
  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const allLogs = logs.data.data.filter((l) =>
    [pane._id, pane2._id, pane3._id].includes(l.pane?._id || l.pane)
  );
  if (allLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: allLogs.map((l) => l._id) });
  }

  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/panes/${pane2._id}`, token);
  await api('DELETE', `/api/panes/${pane3._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/orders/${ordId2}`, token);
  await api('DELETE', `/api/orders/${ordId3}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/requests/${reqId2}`, token);
  await api('DELETE', `/api/requests/${reqId3}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 3. WEBSOCKET EVENTS
// ──────────────────────────────────────────────

async function testWebSocketEvents(token) {
  console.log('\n=== Scan WebSocket Events ===\n');

  const socket = await connectSocket(token);
  await emitWithAck(socket, 'join_dashboard');
  await emitWithAck(socket, 'join_pane');
  await emitWithAck(socket, 'join_production');
  await emitWithAck(socket, 'join_station');
  await emitWithAck(socket, 'join_me');
  console.log('   (joined rooms)\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Scan WS Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Scan WS Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [{ routing: ['cutting', 'qc'] }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 1,
    request: reqId,
    paneCount: 1,
    assignedTo: workerId,
  });
  const ordId = ordRes.data.data._id;

  // ── scan_in at cutting (first station) → expect pane:updated event ──
  let paneEventPromise = waitForEvent(socket, 'pane:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_in' });
  const scanInEvent = await paneEventPromise;
  check('WS pane:updated on scan_in', scanInEvent.action, 'updated');

  // ── complete at cutting → expect pane:updated (stays at cutting, awaiting scan_out) ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  const completeEvent = await paneEventPromise;
  check('WS pane:updated on complete', completeEvent.action, 'updated');

  // ── scan_out at cutting → expect pane:updated + notification (pane arrives at qc) ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  const notifPromise = waitForEvent(socket, 'notification');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });

  const scanOutEvent = await paneEventPromise;
  check('WS pane:updated on scan_out', scanOutEvent.action, 'updated');

  const notifEvent = await notifPromise;
  check('WS notification fired', notifEvent.type, 'pane_arrived');
  checkIncludes('  notification message', notifEvent.message, pane.paneNumber);

  // ── complete + scan_out qc (last) → completed, expect order:updated ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  await paneEventPromise;

  paneEventPromise = waitForEvent(socket, 'pane:updated');
  const orderEventPromise = waitForEvent(socket, 'order:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });

  const finalPaneEvent = await paneEventPromise;
  check('WS pane:updated on final scan_out', finalPaneEvent.action, 'updated');

  const orderEvent = await orderEventPromise;
  check('WS order:updated fired', orderEvent.action, 'updated');

  socket.disconnect();
  console.log('   (disconnected)\n');

  // ── cleanup ──
  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) => n.type === 'pane_arrived');
  if (scanNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: scanNotifs.map((n) => n._id) });
  }

  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) => (l.pane?._id || l.pane) === pane._id);
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 4. NOTIFICATIONS CREATED
// ──────────────────────────────────────────────

async function testNotifications(token) {
  console.log('\n=== Scan Notifications ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Scan Notif Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Scan Notif Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [{ routing: ['cutting', 'qc'] }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 1,
    request: reqId,
    paneCount: 1,
    assignedTo: workerId,
  });
  const ordId = ordRes.data.data._id;

  // Complete + scan_out through all stations (pane starts at cutting)
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });

  // Check notifications were created
  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' && n.message.includes(pane.paneNumber)
  );

  check('notifications created for each advance', scanNotifs.length >= 2, true);
  console.log(`          found ${scanNotifs.length} scan notifications`);

  const arrivalNotif = scanNotifs.find((n) => n.message.includes('qc'));
  if (arrivalNotif) {
    check('  arrival notification has correct type', arrivalNotif.type, 'pane_arrived');
    check('  arrival notification priority', arrivalNotif.priority, 'medium');
  }

  const completedNotif = scanNotifs.find((n) => n.message.includes('completed'));
  if (completedNotif) {
    check('  completed notification exists', !!completedNotif, true);
    check('  completed notification priority', completedNotif.priority, 'low');
  }

  // No notification for order without assignedTo
  const ordRes2 = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 1,
  });
  const ordId2 = ordRes2.data.data._id;

  const reqRes2 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: ['cutting'] }],
  });
  const reqId2 = reqRes2.data.data._id;
  const pane2 = reqRes2.data.data.panes[0];

  const notifCountBefore = (await api('GET', '/api/notifications?limit=100', token)).data.pagination.total;
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });
  const notifCountAfter = (await api('GET', '/api/notifications?limit=100', token)).data.pagination.total;
  check('no notification when order has no assignedTo', notifCountAfter, notifCountBefore);

  // ── cleanup ──
  if (scanNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: scanNotifs.map((n) => n._id) });
  }

  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const allLogs = logs.data.data.filter((l) =>
    [pane._id, pane2._id].includes(l.pane?._id || l.pane)
  );
  if (allLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: allLogs.map((l) => l._id) });
  }

  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/panes/${pane2._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/orders/${ordId2}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/requests/${reqId2}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 5. SCAN_OUT EDGE CASES
// ──────────────────────────────────────────────

async function testScanOutEdgeCases(token) {
  console.log('\n=== Scan Out Edge Cases ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'ScanOut Edge Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'ScanOut Edge Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [
      { routing: ['cutting', 'edging', 'qc'] },
      { routing: ['cutting'] },
      { routing: ['cutting', 'qc'] },
    ],
  });
  const reqId = reqRes.data.data._id;
  const pane1 = reqRes.data.data.panes[0];
  const pane2 = reqRes.data.data.panes[1];
  const pane3 = reqRes.data.data.panes[2];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 3, request: reqId, paneCount: 3, assignedTo: workerId,
  });
  const ordId = ordRes.data.data._id;

  // ── scan_out at wrong station ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  const r1 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'edging', action: 'scan_out',
  });
  check('scan_out at wrong station', r1.status, 400);
  checkIncludes('  message mentions actual station', r1.data.message, 'cutting');

  // ── double complete is idempotent (stays awaiting_scan_out) ──
  const r2 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'complete',
  });
  check('double complete stays awaiting_scan_out', r2.status, 200);
  check('  status still awaiting_scan_out', r2.data.data.pane.currentStatus, 'awaiting_scan_out');

  // ── scan_out at correct station after double complete ──
  const r3 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('scan_out after double complete', r3.status, 200);
  check('  pane advanced to edging', r3.data.data.pane.currentStation, 'edging');

  // ── scan_in at new station after scan_out ──
  const r4 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: 'edging', action: 'scan_in',
  });
  check('scan_in at next station after scan_out', r4.status, 200);
  check('  status is in_progress', r4.data.data.pane.currentStatus, 'in_progress');

  // ── complete → scan_out → scan_in → complete → scan_out (full cycle) ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'edging', action: 'complete' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'edging', action: 'scan_out' });
  const r5 = await api('GET', `/api/panes/${pane1._id}`, token);
  check('pane at qc after edging scan_out', r5.data.data.currentStation, 'qc');
  check('  status is pending', r5.data.data.currentStatus, 'pending');

  // ── single-station pane: complete + scan_out ──
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_in' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  const r6 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('single-station pane scan_out completes', r6.status, 200);
  check('  status is completed', r6.data.data.pane.currentStatus, 'completed');
  check('  completedAt is set', !!r6.data.data.pane.completedAt, true);
  check('  no nextStation', r6.data.data.nextStation, undefined);

  // ── scan_out on completed pane fails ──
  const r7 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_out',
  });
  check('scan_out on completed pane fails', r7.status, 400);
  checkIncludes('  message says completed', r7.data.message, 'already completed');

  // ── complete on completed pane also fails ──
  const r8 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: 'cutting', action: 'complete',
  });
  check('complete on completed pane fails', r8.status, 400);

  // ── scan_in on completed pane also fails ──
  const r9 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: 'cutting', action: 'scan_in',
  });
  check('scan_in on completed pane fails', r9.status, 400);

  // ── order progress: partial completion ──
  const ordMid = await api('GET', `/api/orders/${ordId}`, token);
  check('order panesCompleted after 1 of 3', ordMid.data.data.panesCompleted, 1);
  check('  progressPercent', ordMid.data.data.progressPercent, 33);

  // ── complete remaining panes and verify full order completion ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'qc', action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });

  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: 'qc', action: 'complete' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: 'qc', action: 'scan_out' });

  const ordFinal = await api('GET', `/api/orders/${ordId}`, token);
  check('order fully completed', ordFinal.data.data.status, 'completed');
  check('  panesCompleted', ordFinal.data.data.panesCompleted, 3);
  check('  progressPercent', ordFinal.data.data.progressPercent, 100);

  // ── pane log entries include all action types ──
  const logs = await api('GET', '/api/pane-logs?limit=200', token);
  const pane1Logs = logs.data.data.filter((l) => (l.pane?._id || l.pane) === pane1._id);
  const actionTypes = [...new Set(pane1Logs.map((l) => l.action))];
  check('pane logs have scan_in', actionTypes.includes('scan_in'), true);
  check('pane logs have complete', actionTypes.includes('complete'), true);
  check('pane logs have scan_out', actionTypes.includes('scan_out'), true);

  // ── notifications created for scan_out advances ──
  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' && (
      n.message.includes(pane1.paneNumber) ||
      n.message.includes(pane2.paneNumber) ||
      n.message.includes(pane3.paneNumber)
    )
  );
  check('notifications created for scan_out', scanNotifs.length >= 3, true);
  console.log(`          found ${scanNotifs.length} notifications`);

  // ── cleanup (cascade handles children) ──
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('=== QR Scan Test Suite ===');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}`);

  await testBasicScanFlow(token);
  await testErrorCases(token);
  await testWebSocketEvents(token);
  await testNotifications(token);
  await testScanOutEdgeCases(token);

  console.log('\n========================================');
  console.log(`   PASSED: ${passed}`);
  console.log(`   FAILED: ${failed}`);
  console.log(`   TOTAL:  ${passed + failed}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
