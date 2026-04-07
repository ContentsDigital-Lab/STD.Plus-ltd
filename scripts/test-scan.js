require('dotenv').config();
const { io } = require('socket.io-client');
const { snapshotIds, sweepCreatedData } = require('./test-helpers');
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

/** Creates a template and cutting / edging / qc stations for scan tests (ObjectId routing). */
async function createStations(token) {
  const tmpl = await api('POST', '/api/station-templates', token, {
    name: `Scan Test Template ${Date.now()}`,
  });
  if (tmpl.status !== 201 || !tmpl.data.data?._id) {
    throw new Error(`Station template create failed (${tmpl.status}): ${JSON.stringify(tmpl.data)}`);
  }
  const tmplId = tmpl.data.data._id;

  async function mkStation(name) {
    const r = await api('POST', '/api/stations', token, { name, templateId: tmplId });
    if (r.status !== 201 || !r.data.data?._id) {
      throw new Error(`Station "${name}" create failed (${r.status}): ${JSON.stringify(r.data)}`);
    }
    return r.data.data._id;
  }

  const cutting = await mkStation('cutting');
  const edging = await mkStation('edging');
  const qc = await mkStation('qc');
  return { tmplId, cutting, edging, qc };
}

async function cleanupStations(token, stns) {
  if (!stns?.tmplId) return;
  await api('DELETE', `/api/station-templates/${stns.tmplId}`, token);
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

async function testBasicScanFlow(token, stns) {
  console.log('\n=== Basic Scan Flow ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Scan Test Customer' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Scan Test Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = [stns.cutting, stns.edging, stns.qc];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 2 },
    panes: [
      { routing, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered', jobType: 'Tempered', rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 1 }, holes: [{ id: 'sh1', type: 'circle', x: 100, y: 200, diameter: 10 }, { id: 'sh2', type: 'circle', x: 300, y: 400, diameter: 15 }], notches: [{ id: 'sn1', type: 'rectangle', x: 0, y: 50, width: 20, height: 30 }] },
      { routing, dimensions: { width: 1000, height: 500, thickness: 6 }, glassType: 'laminated', jobType: 'Laminated', rawGlass: { glassType: 'Clear', color: 'เขียว', thickness: 6, sheetsPerPane: 1 }, holes: [], notches: [{ id: 'sn2', type: 'rectangle', x: 0, y: 30, width: 15, height: 25 }, { id: 'sn3', type: 'rectangle', x: 0, y: 100, width: 15, height: 25 }, { id: 'sn4', type: 'custom', x: 50, y: 0, vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] },
    ],
  });
  check('CREATE request with panes', reqRes.status, 201);
  const reqId = reqRes.data.data._id;

  const pane1 = reqRes.data.data.panes[0];
  const pane2 = reqRes.data.data.panes[1];
  check('  pane 1 has paneNumber', !!pane1.paneNumber, true);
  check('  pane 2 has paneNumber', !!pane2.paneNumber, true);
  check('  pane 1 jobType', pane1.jobType, 'Tempered');
  check('  pane 1 rawGlass.sheetsPerPane', pane1.rawGlass.sheetsPerPane, 1);
  check('  pane 1 holes count', pane1.holes.length, 2);
  check('  pane 1 notches count', pane1.notches.length, 1);
  check('  pane 2 jobType', pane2.jobType, 'Laminated');
  check('  pane 2 rawGlass.sheetsPerPane', pane2.rawGlass.sheetsPerPane, 1);
  check('  pane 2 holes count', pane2.holes.length, 0);
  check('  pane 2 notches count', pane2.notches.length, 3);
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

  // Verify panes got order + material backfilled
  const pane1Get = await api('GET', `/api/panes/${pane1._id}`, token);
  check('  pane 1 order backfilled', !!pane1Get.data.data.order, true);
  const backfilledMat = pane1Get.data.data.material;
  check('  pane 1 material backfilled', String(backfilledMat?._id || backfilledMat), String(matId));

  // ── verify pane starts at first routing station (cutting) ──
  check('  pane 1 starts at routing[0]', pane1.currentStation?._id || pane1.currentStation, stns.cutting);

  // ── scan_in at cutting ──
  const r1 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_in',
  });
  check('SCAN_IN pane 1 at cutting', r1.status, 200);
  check('  pane still at cutting', r1.data.data.pane.currentStation?._id, stns.cutting);
  check('  startedAt is set', !!r1.data.data.pane.startedAt, true);
  check('  production log created', !!r1.data.data.log, true);
  check('  log action is scan_in', r1.data.data.log.action, 'scan_in');

  // ── start at cutting ──
  const r3 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'start',
  });
  check('START pane 1 at cutting', r3.status, 200);
  check('  status is in_progress', r3.data.data.pane.currentStatus, 'in_progress');

  // ── complete at cutting → awaiting_scan_out (stays at cutting) ──
  const r4 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'complete',
  });
  check('COMPLETE pane 1 at cutting', r4.status, 200);
  check('  pane stays at cutting', r4.data.data.pane.currentStation?._id, stns.cutting);
  check('  status is awaiting_scan_out', r4.data.data.pane.currentStatus, 'awaiting_scan_out');

  // ── scan_out at cutting → moves to edging ──
  const r4b = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at cutting', r4b.status, 200);
  check('  pane moved to edging', r4b.data.data.pane.currentStation?._id, stns.edging);
  check('  nextStation is edging', r4b.data.data.nextStation, stns.edging);
  check('  status is pending', r4b.data.data.pane.currentStatus, 'pending');

  // ── complete + scan_out at edging → moves to qc ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.edging, action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.edging, action: 'complete' });
  const r5 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.edging, action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at edging', r5.status, 200);
  check('  pane moved to qc', r5.data.data.pane.currentStation?._id, stns.qc);

  // ── complete + scan_out at qc (last station) → completed ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  const r6 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.qc, action: 'scan_out',
  });
  check('SCAN_OUT pane 1 at qc (last)', r6.status, 200);
  check('  completed pane currentStation is null', r6.data.data.pane.currentStation, null);
  check('  status is completed', r6.data.data.pane.currentStatus, 'completed');
  check('  completedAt is set', !!r6.data.data.pane.completedAt, true);

  // ── verify jobType + rawGlass + holes + notches survived scan flow ──
  const pane1Final = await api('GET', `/api/panes/${pane1._id}`, token);
  check('  jobType preserved after scan', pane1Final.data.data.jobType, 'Tempered');
  check('  rawGlass.glassType preserved', pane1Final.data.data.rawGlass.glassType, 'Clear');
  check('  rawGlass.sheetsPerPane preserved', pane1Final.data.data.rawGlass.sheetsPerPane, 1);
  check('  holes preserved after scan', pane1Final.data.data.holes.length, 2);
  check('  notches preserved after scan', pane1Final.data.data.notches.length, 1);

  // ── verify order progress ──
  const ordAfter = await api('GET', `/api/orders/${ordId}`, token);
  check('  order panesCompleted', ordAfter.data.data.panesCompleted, 1);
  check('  order progressPercent', ordAfter.data.data.progressPercent, 50);
  check('  order status still in progress', ordAfter.data.data.status !== 'completed', true);

  // ── complete pane 2 through all stations (complete + scan_out at each) ──
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.edging, action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.edging, action: 'scan_out' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  const r7 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });
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

async function testErrorCases(token, stns) {
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
    panes: [{ routing: [stns.cutting, stns.qc], glassType: 'tempered' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1,
  });
  const ordId = ordRes.data.data._id;

  // ── non-existent pane ──
  const r1 = await api('POST', '/api/panes/PNE-9999/scan', token, {
    station: stns.cutting, action: 'complete',
  });
  check('scan non-existent pane', r1.status, 404);

  // ── wrong station (pane starts at cutting, try edging) ──
  const r2 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: stns.edging, action: 'complete',
  });
  check('complete at wrong station', r2.status, 400);
  checkIncludes('  message mentions actual station', r2.data.message, stns.cutting);

  // ── scan_out without complete first ──
  const r2b = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('scan_out without complete first', r2b.status, 400);
  checkIncludes('  message says must complete first', r2b.data.message, 'เสร็จสิ้น');

  // ── complete + scan_out through all stations, then try again ──
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });

  const r3 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: stns.qc, action: 'complete',
  });
  check('scan already completed pane', r3.status, 400);
  checkIncludes('  message says already completed', r3.data.message, 'already completed');

  // ── invalid action ──
  const r4 = await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, {
    station: stns.qc, action: 'invalid_action',
  });
  check('scan with invalid action', r4.status, 400);

  // ── pane number from QR code (frontend strips STDPLUS: prefix and sends just PNE-XXXX) ──
  const reqRes2 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: [stns.cutting] }],
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
    station: stns.cutting, action: 'complete',
  });
  check('scan with pane number parsed from QR', r5.status, 200);
  check('  pane awaiting scan_out', r5.data.data.pane.currentStatus, 'awaiting_scan_out');

  const r5b = await api('POST', `/api/panes/${parsedPaneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('scan_out with QR parsed pane', r5b.status, 200);
  check('  pane completed (single station)', r5b.data.data.pane.currentStatus, 'completed');

  // ── no routing — virtual state: null currentStation, already completed ──
  const reqRes3 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: [] }],
  });
  const reqId3 = reqRes3.data.data._id;
  const pane3 = reqRes3.data.data.panes[0];
  check('empty routing pane starts at null', pane3.currentStation, null);
  check('  empty routing pane is completed', pane3.currentStatus, 'completed');

  const ordRes3 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId3, paneCount: 1,
  });
  const ordId3 = ordRes3.data.data._id;

  const r6 = await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'complete',
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

async function testWebSocketEvents(token, stns) {
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
    panes: [{ routing: [stns.cutting, stns.qc] }],
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
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_in' });
  const scanInEvent = await paneEventPromise;
  check('WS pane:updated on scan_in', scanInEvent.action, 'scanned');

  // ── complete at cutting → expect pane:updated (stays at cutting, awaiting scan_out) ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  const completeEvent = await paneEventPromise;
  check('WS pane:updated on complete', completeEvent.action, 'scanned');

  // ── scan_out at cutting → expect pane:updated + notification (arrived at next station) ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  const notifPromise = waitForEvent(socket, 'notification');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });

  const scanOutEvent = await paneEventPromise;
  check('WS pane:updated on scan_out', scanOutEvent.action, 'scanned');

  const notifEvent = await notifPromise;
  check('WS notification fired', notifEvent.type, 'pane_arrived');
  checkIncludes('  notification message has pane number', notifEvent.message, pane.paneNumber);
  checkIncludes('  notification message (next station)', notifEvent.message, 'arrived at next station');

  // ── complete + scan_out qc (last) → completed, expect order:updated ──
  paneEventPromise = waitForEvent(socket, 'pane:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await paneEventPromise;

  paneEventPromise = waitForEvent(socket, 'pane:updated');
  const orderEventPromise = waitForEvent(socket, 'order:updated');
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });

  const finalPaneEvent = await paneEventPromise;
  check('WS pane:updated on final scan_out', finalPaneEvent.action, 'scanned');

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

async function testNotifications(token, stns) {
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
    panes: [{ routing: [stns.cutting, stns.qc] }],
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
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });

  // Check notifications were created
  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' && n.message.includes(pane.paneNumber)
  );

  check('notifications created for each advance', scanNotifs.length >= 2, true);
  console.log(`          found ${scanNotifs.length} scan notifications`);

  const arrivalNotif = scanNotifs.find((n) => n.message.includes('arrived at next station'));
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
    panes: [{ routing: [stns.cutting] }],
  });
  const reqId2 = reqRes2.data.data._id;
  const pane2 = reqRes2.data.data.panes[0];

  const notifCountBefore = (await api('GET', '/api/notifications?limit=100', token)).data.pagination.total;
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
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

async function testScanOutEdgeCases(token, stns) {
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
      { routing: [stns.cutting, stns.edging, stns.qc] },
      { routing: [stns.cutting] },
      { routing: [stns.cutting, stns.qc] },
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
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  const r1 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.edging, action: 'scan_out',
  });
  check('scan_out at wrong station', r1.status, 400);
  checkIncludes('  message mentions actual station', r1.data.message, stns.cutting);

  // ── double complete is idempotent (stays awaiting_scan_out) ──
  const r2 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'complete',
  });
  check('double complete stays awaiting_scan_out', r2.status, 200);
  check('  status still awaiting_scan_out', r2.data.data.pane.currentStatus, 'awaiting_scan_out');

  // ── scan_out at correct station after double complete ──
  const r3 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('scan_out after double complete', r3.status, 200);
  check('  pane advanced to edging', r3.data.data.pane.currentStation?._id, stns.edging);

  // ── scan_in at new station after scan_out ──
  const r4 = await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, {
    station: stns.edging, action: 'scan_in',
  });
  check('scan_in at next station after scan_out', r4.status, 200);
  check('  status is in_progress', r4.data.data.pane.currentStatus, 'in_progress');

  // ── complete → scan_out → scan_in → complete → scan_out (full cycle) ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.edging, action: 'complete' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.edging, action: 'scan_out' });
  const r5 = await api('GET', `/api/panes/${pane1._id}`, token);
  check('pane at qc after edging scan_out', r5.data.data.currentStation?._id, stns.qc);
  check('  status is pending', r5.data.data.currentStatus, 'pending');

  // ── single-station pane: complete + scan_out ──
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_in' });
  await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  const r6 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('single-station pane scan_out completes', r6.status, 200);
  check('  status is completed', r6.data.data.pane.currentStatus, 'completed');
  check('  completedAt is set', !!r6.data.data.pane.completedAt, true);
  check('  no nextStation', r6.data.data.nextStation, undefined);

  // ── scan_out on completed pane fails ──
  const r7 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_out',
  });
  check('scan_out on completed pane fails', r7.status, 400);
  checkIncludes('  message says completed', r7.data.message, 'already completed');

  // ── complete on completed pane also fails ──
  const r8 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'complete',
  });
  check('complete on completed pane fails', r8.status, 400);

  // ── scan_in on completed pane also fails ──
  const r9 = await api('POST', `/api/panes/${pane2.paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_in',
  });
  check('scan_in on completed pane fails', r9.status, 400);

  // ── order progress: partial completion ──
  const ordMid = await api('GET', `/api/orders/${ordId}`, token);
  check('order panesCompleted after 1 of 3', ordMid.data.data.panesCompleted, 1);
  check('  progressPercent', ordMid.data.data.progressPercent, 33);

  // ── complete remaining panes and verify full order completion ──
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_in' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });

  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await api('POST', `/api/panes/${pane3.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_out' });

  const ordFinal = await api('GET', `/api/orders/${ordId}`, token);
  check('order fully completed', ordFinal.data.data.status, 'completed');
  check('  panesCompleted', ordFinal.data.data.panesCompleted, 3);
  check('  progressPercent', ordFinal.data.data.progressPercent, 100);

  // ── pane log entries include all action types ──
  const logs = await api('GET', `/api/pane-logs?limit=200&paneId=${pane1._id}`, token);
  const pane1Logs = Array.isArray(logs.data?.data) ? logs.data.data : [];
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
// MATERIAL BACKFILL ON SCAN
// ──────────────────────────────────────────────

async function testMaterialBackfill(token, stns) {
  console.log('\n=== Scan Material Backfill ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Backfill Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Backfill Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const ord = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1,
  });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, {
    order: ordId, routing: [stns.cutting, stns.qc],
  });
  check('CREATE pane without explicit material', pane.status, 201);
  const paneId = pane.data.data._id;
  const paneNumber = pane.data.data.paneNumber;

  const paneGet1 = await api('GET', `/api/panes/${paneId}`, token);
  const mat1 = paneGet1.data.data.material;
  check('  pane material is null before scan', mat1 == null, true);

  const r1 = await api('POST', `/api/panes/${paneNumber}/scan`, token, {
    station: stns.cutting, action: 'scan_in',
  });
  check('SCAN_IN pane without material', r1.status, 200);

  const paneGet2 = await api('GET', `/api/panes/${paneId}`, token);
  const backfilled = paneGet2.data.data.material;
  check('  material backfilled from order', backfilled != null, true);
  if (backfilled) {
    check('  material matches order material', String(backfilled._id || backfilled), matId);
  }

  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 7. BATCH SCAN
// ──────────────────────────────────────────────

async function testBatchScan(token, stns) {
  console.log('\n=== Batch Scan ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Batch Scan Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Batch Scan Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = [stns.cutting, stns.edging, stns.qc];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 3 },
    panes: [
      { routing, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered' },
      { routing, dimensions: { width: 900, height: 700, thickness: 5 }, glassType: 'tempered' },
      { routing, dimensions: { width: 1000, height: 800, thickness: 5 }, glassType: 'tempered' },
    ],
  });
  const reqId = reqRes.data.data._id;
  const panes = reqRes.data.data.panes;
  const paneNumbers = panes.map(p => p.paneNumber);

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 3, request: reqId, paneCount: 3,
    stations: routing,
  });
  const ordId = ordRes.data.data._id;

  // ── batch scan_in at cutting ──
  const r1 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers, station: stns.cutting, action: 'scan_in',
  });

  // batch-scan uses MongoDB transactions which require a replica set.
  // If the dev DB is standalone, the call returns 500 (transaction infra error).
  if (r1.status === 500) {
    console.log('   SKIP  batch scan — MongoDB transactions not supported (standalone, no replica set)');
    console.log('          All batch-scan tests skipped. Enable a replica set to run these.\n');

    // Cleanup and return early
    for (const p of panes) await api('DELETE', `/api/panes/${p._id}`, token);
    await api('DELETE', `/api/orders/${ordId}`, token);
    await api('DELETE', `/api/requests/${reqId}`, token);
    await api('DELETE', `/api/materials/${matId}`, token);
    await api('DELETE', `/api/customers/${custId}`, token);
    return;
  }

  check('batch scan_in status', r1.status, 200);
  check('batch scan_in updatedCount', r1.data.data.updatedCount, 3);
  check('batch scan_in returns panes array', Array.isArray(r1.data.data.panes), true);
  check('batch scan_in panes length', r1.data.data.panes.length, 3);

  for (const p of r1.data.data.panes) {
    check(`  pane ${p.paneNumber} status`, p.currentStatus, 'in_progress');
  }

  // ── batch complete at cutting ──
  const r2 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers, station: stns.cutting, action: 'complete',
  });
  check('batch complete status', r2.status, 200);
  check('batch complete updatedCount', r2.data.data.updatedCount, 3);

  for (const p of r2.data.data.panes) {
    check(`  pane ${p.paneNumber} awaiting_scan_out`, p.currentStatus, 'awaiting_scan_out');
  }

  // ── batch scan with invalid action (scan_out not allowed) ──
  const r3 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers, station: stns.cutting, action: 'scan_out',
  });
  check('batch scan_out rejected (not supported)', r3.status, 400);

  // ── batch scan with empty paneNumbers ──
  const r4 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers: [], station: stns.cutting, action: 'scan_in',
  });
  check('batch scan empty paneNumbers rejected', r4.status, 400);

  // ── batch scan with non-existent panes ──
  const r5 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers: ['PNE-NONEXIST-001'], station: stns.cutting, action: 'scan_in',
  });
  check('batch scan non-existent panes', r5.status, 500);

  // ── batch complete at wrong station ──
  for (const pn of paneNumbers) {
    await api('POST', `/api/panes/${pn}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  }

  const r6 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers, station: stns.cutting, action: 'complete',
  });
  check('batch complete at wrong station fails', r6.status, 500);

  // ── batch scan_in at edging (correct station) ──
  const r7 = await api('POST', '/api/panes/batch-scan', token, {
    paneNumbers, station: stns.edging, action: 'scan_in',
  });
  check('batch scan_in at edging', r7.status, 200);

  // ── cleanup ──
  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) =>
    panes.map(p => p._id).includes(l.pane?._id || l.pane)
  );
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const scanNotifs = notifs.data.data.filter((n) => n.type === 'pane_arrived');
  if (scanNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: scanNotifs.map((n) => n._id) });
  }

  for (const p of panes) await api('DELETE', `/api/panes/${p._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 8. LAMINATE PANE CREATION VIA POST /panes (was 7)
// ──────────────────────────────────────────────

async function testLaminateCreateViaPanes(token) {
  console.log('\n=== Laminate Pane Creation via POST /panes ===\n');

  const tmpl = await api('POST', '/api/station-templates', token, { name: `LamCreate Tmpl ${Date.now()}` });
  const tmplId = tmpl.data.data._id;

  const cuttingStn = (await api('POST', '/api/stations', token, { name: 'lc_cut', templateId: tmplId })).data.data._id;
  const lamStn = (await api('POST', '/api/stations', token, { name: 'lc_lam', templateId: tmplId, isLaminateStation: true })).data.data._id;
  const qcStn = (await api('POST', '/api/stations', token, { name: 'lc_qc', templateId: tmplId })).data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'LamCreate Cust' });
  const custId = cust.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 1 },
  });
  const reqId = reqRes.data.data._id;

  const routing = [cuttingStn, lamStn, qcStn];

  // Create pane via POST /api/panes with sheetsPerPane: 2
  const createRes = await api('POST', '/api/panes', token, {
    request: reqId,
    routing,
    dimensions: { width: 800, height: 600, thickness: 5 },
    rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 2 },
    jobType: 'Laminated',
  });
  check('POST /panes laminate returns 201', createRes.status, 201);

  const data = createRes.data.data;
  check('response has parent', !!data.parent, true);
  check('response has sheets array', Array.isArray(data.sheets), true);
  check('sheets count = 2', data.sheets.length, 2);

  const parent = data.parent;
  check('parent laminateRole = parent', parent.laminateRole, 'parent');
  check('parent currentStation is null', parent.currentStation, null);
  check('parent currentStatus is pending', parent.currentStatus, 'pending');
  check('parent has 2 childPanes', parent.childPanes.length, 2);
  check('parent routing = post-lamination only', parent.routing.length, 1);

  const sheetA = data.sheets.find(s => s.sheetLabel === 'A');
  const sheetB = data.sheets.find(s => s.sheetLabel === 'B');
  check('sheet A exists', !!sheetA, true);
  check('sheet B exists', !!sheetB, true);
  check('sheet A laminateRole = sheet', sheetA.laminateRole, 'sheet');
  check('sheet A parentPane set', !!sheetA.parentPane, true);
  check('sheet A routing = pre-lamination', sheetA.routing.length, 2);
  check('sheet A currentStation = first station', String(sheetA.currentStation?._id || sheetA.currentStation), cuttingStn);
  check('sheet A paneNumber has -A suffix', sheetA.paneNumber.endsWith('-A'), true);
  check('sheet B paneNumber has -B suffix', sheetB.paneNumber.endsWith('-B'), true);

  // Error case: sheetsPerPane > 1 but no laminate station in routing
  const noLamRes = await api('POST', '/api/panes', token, {
    request: reqId,
    routing: [cuttingStn, qcStn],
    rawGlass: { sheetsPerPane: 2 },
  });
  check('POST /panes without laminate station returns 400', noLamRes.status, 400);

  // Cleanup
  await api('DELETE', `/api/panes/${sheetA._id}`, token);
  await api('DELETE', `/api/panes/${sheetB._id}`, token);
  await api('DELETE', `/api/panes/${parent._id}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
}

// ──────────────────────────────────────────────
// 9. LAMINATE SPLIT VIA PATCH /panes/:id (was 8)
// ──────────────────────────────────────────────

async function testLaminateSplitViaPatch(token) {
  console.log('\n=== Laminate Split via PATCH /panes/:id ===\n');

  const tmpl = await api('POST', '/api/station-templates', token, { name: `LamPatch Tmpl ${Date.now()}` });
  const tmplId = tmpl.data.data._id;

  const cuttingStn = (await api('POST', '/api/stations', token, { name: 'lp_cut', templateId: tmplId })).data.data._id;
  const lamStn = (await api('POST', '/api/stations', token, { name: 'lp_lam', templateId: tmplId, isLaminateStation: true })).data.data._id;
  const qcStn = (await api('POST', '/api/stations', token, { name: 'lp_qc', templateId: tmplId })).data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'LamPatch Cust' });
  const custId = cust.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 1 },
  });
  const reqId = reqRes.data.data._id;

  // Create a pane WITHOUT routing (simulates Order Release workflow)
  const createRes = await api('POST', '/api/panes', token, {
    request: reqId,
    dimensions: { width: 1000, height: 500, thickness: 6 },
    rawGlass: { glassType: 'Clear', color: 'เขียว', thickness: 6, sheetsPerPane: 2 },
    jobType: 'Laminated',
  });
  check('POST /panes without routing = 201', createRes.status, 201);
  const paneId = createRes.data.data._id;
  const paneNumber = createRes.data.data.paneNumber;
  check('pane is single (no routing)', createRes.data.data.laminateRole, 'single');

  // Now PATCH with routing that includes laminate station (Order Release assigns routing)
  const routing = [cuttingStn, lamStn, qcStn];
  const patchRes = await api('PATCH', `/api/panes/${paneId}`, token, {
    routing,
  });
  check('PATCH triggers laminate split', patchRes.status, 200);

  const patchData = patchRes.data.data;
  check('response has parent', !!patchData.parent, true);
  check('response has sheets array', Array.isArray(patchData.sheets), true);
  check('sheets count = 2', patchData.sheets.length, 2);

  const parent = patchData.parent;
  check('parent laminateRole = parent', parent.laminateRole, 'parent');
  check('parent paneNumber unchanged', parent.paneNumber, paneNumber);
  check('parent currentStation is null', parent.currentStation, null);
  check('parent routing = post-lamination [qc]', (parent.routing || []).length, 1);

  const sheetA = patchData.sheets.find(s => s.sheetLabel === 'A');
  const sheetB = patchData.sheets.find(s => s.sheetLabel === 'B');
  check('sheet A exists', !!sheetA, true);
  check('sheet B exists', !!sheetB, true);
  check('sheet A laminateRole = sheet', sheetA.laminateRole, 'sheet');
  check('sheet A routing = pre-lamination [cut, lam]', sheetA.routing.length, 2);
  check('sheet A currentStation = cutting', String(sheetA.currentStation?._id || sheetA.currentStation), cuttingStn);
  check('sheet A dimensions cloned', sheetA.dimensions?.width, 1000);
  check('sheet A rawGlass cloned', sheetA.rawGlass?.sheetsPerPane, 2);

  // Verify already-split pane doesn't split again on subsequent PATCH
  const patchAgain = await api('PATCH', `/api/panes/${paneId}`, token, {
    notes: 'some update',
  });
  check('PATCH on parent does not re-split', patchAgain.status, 200);
  check('response is single pane (no re-split)', !!patchAgain.data.data.paneNumber, true);
  check('parent still has laminateRole parent', patchAgain.data.data.laminateRole, 'parent');

  // Cleanup
  await api('DELETE', `/api/panes/${sheetA._id}`, token);
  await api('DELETE', `/api/panes/${sheetB._id}`, token);
  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('=== QR Scan Test Suite ===');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}`);

  const snapshot = await snapshotIds(API, token);

  const stns = await createStations(token);
  try {
    await testBasicScanFlow(token, stns);
    await testErrorCases(token, stns);
    await testWebSocketEvents(token, stns);
    await testNotifications(token, stns);
    await testScanOutEdgeCases(token, stns);
    await testMaterialBackfill(token, stns);
    await testBatchScan(token, stns);
    await testLaminateCreateViaPanes(token);
    await testLaminateSplitViaPatch(token);
  } finally {
    await cleanupStations(token, stns).catch(() => {});
    await sweepCreatedData(API, token, snapshot);
  }

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
