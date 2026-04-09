require('dotenv').config();
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

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`   PASS  ${label} — ${actual}`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — got ${actual}, expected ${expected}`);
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

function stationRefId(station) {
  if (station == null) return null;
  return String(station._id != null ? station._id : station);
}

/** ObjectId or populated subdoc from API */
function docRefId(ref) {
  if (ref == null) return null;
  if (typeof ref === 'object' && ref._id != null) return String(ref._id);
  return String(ref);
}

async function createStations(token) {
  const tmpl = await api('POST', '/api/station-templates', token, {
    name: 'Integrity Test Template',
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
  const polishing = await mkStation('polishing');
  const inspection = await mkStation('inspection');
  const qc = await mkStation('qc');
  const tempering = await mkStation('tempering');
  return { tmplId, cutting, polishing, inspection, qc, tempering };
}

async function cleanupStations(token, stns) {
  if (!stns?.tmplId) return;
  await api('DELETE', `/api/station-templates/${stns.tmplId}`, token);
}

async function getRoleIds(token) {
  const res = await api('GET', '/api/roles', token);
  const roles = res.data.data;
  const map = {};
  for (const r of roles) map[r.slug] = r._id;
  return map;
}

// ──────────────────────────────────────────────
// 1. CASCADE DELETE PROTECTION
// ──────────────────────────────────────────────

async function testCascadeDeletes(token, roleIds) {
  console.log('\n=== Cascade Delete ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  // Material → cascades inventory
  const mat = await api('POST', '/api/materials', token, { name: 'Cascade Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const inv = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'WH-A' });
  const invId = inv.data.data._id;

  const r1 = await api('DELETE', `/api/materials/${matId}`, token);
  check('DELETE material cascades inventory', r1.status, 200);
  const r1b = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory also deleted', r1b.status, 404);

  // Order → cascades claims, panes, production logs
  const mat2 = await api('POST', '/api/materials', token, { name: 'Cascade Glass 2', unit: 'sheet', reorderPoint: 5 });
  const matId2 = mat2.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'Cascade Customer' });
  const custId = cust.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId2, quantity: 5 });
  const ordId = ord.data.data._id;

  const claim = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'worker', material: matId2, description: 'Test claim', reportedBy: workerId,
  });
  const claimId = claim.data.data._id;

  const pane = await api('POST', '/api/panes', token, { order: ordId });
  const paneId = pane.data.data._id;

  const r2 = await api('DELETE', `/api/orders/${ordId}`, token);
  check('DELETE order cascades children', r2.status, 200);
  const r2b = await api('GET', `/api/claims/${claimId}`, token);
  check('  claim also deleted', r2b.status, 404);
  const r2c = await api('GET', `/api/panes/${paneId}`, token);
  check('  pane also deleted', r2c.status, 404);

  // Customer → cascades orders + requests
  const ord2 = await api('POST', '/api/orders', token, { customer: custId, material: matId2, quantity: 3 });
  const ordId2 = ord2.data.data._id;

  const r3 = await api('DELETE', `/api/customers/${custId}`, token);
  check('DELETE customer cascades orders', r3.status, 200);
  const r3b = await api('GET', `/api/orders/${ordId2}`, token);
  check('  order also deleted', r3b.status, 404);

  // Bulk delete materials with inventory refs → cascades
  const mat3 = await api('POST', '/api/materials', token, { name: 'Bulk Mat A', unit: 'kg', reorderPoint: 1 });
  const mat4 = await api('POST', '/api/materials', token, { name: 'Bulk Mat B', unit: 'kg', reorderPoint: 1 });
  const matId3 = mat3.data.data._id;
  const matId4 = mat4.data.data._id;
  await api('POST', '/api/inventories', token, { material: matId3, stockType: 'Raw', quantity: 10, location: 'WH' });

  const r4 = await api('DELETE', '/api/materials', token, { ids: [matId3, matId4] });
  check('DELETE MANY materials cascades inventory', r4.status, 200);

  // Worker → cascades orders, notifications
  const w = await api('POST', '/api/workers', token, { name: 'Temp Worker', username: 'temp_cascade', password: 'temp123456', position: 'temp', role: roleIds.worker });
  const wId = w.data.data._id;
  const mat5 = await api('POST', '/api/materials', token, { name: 'Worker Mat', unit: 'pc', reorderPoint: 1 });
  const matId5 = mat5.data.data._id;
  const cust2 = await api('POST', '/api/customers', token, { name: 'Worker Cust' });
  const custId2 = cust2.data.data._id;
  const ord3 = await api('POST', '/api/orders', token, { customer: custId2, material: matId5, quantity: 1, assignedTo: wId });
  const ordId3 = ord3.data.data._id;

  const r5 = await api('DELETE', `/api/workers/${wId}`, token);
  check('DELETE worker cascades orders', r5.status, 200);
  const r5b = await api('GET', `/api/orders/${ordId3}`, token);
  check('  order also deleted', r5b.status, 404);

  await api('DELETE', `/api/materials/${matId2}`, token);
  await api('DELETE', `/api/materials/${matId5}`, token);
  await api('DELETE', `/api/customers/${custId2}`, token);
}

// ──────────────────────────────────────────────
// 2. REFERENTIAL CHECKS ON CREATE/UPDATE
// ──────────────────────────────────────────────

async function testReferentialChecks(token) {
  console.log('\n=== Referential Checks (Create/Update) ===\n');

  const fakeId = '000000000000000000000000';

  // Order with non-existent customer
  const mat = await api('POST', '/api/materials', token, { name: 'Ref Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const r1 = await api('POST', '/api/orders', token, { customer: fakeId, material: matId, quantity: 5 });
  check('CREATE order with fake customer', r1.status, 400);
  checkIncludes('  message says Customer', r1.data.message, 'Customer not found');

  // Order with non-existent material
  const cust = await api('POST', '/api/customers', token, { name: 'Ref Cust' });
  const custId = cust.data.data._id;

  const r2 = await api('POST', '/api/orders', token, { customer: custId, material: fakeId, quantity: 5 });
  check('CREATE order with fake material', r2.status, 400);
  checkIncludes('  message says Material', r2.data.message, 'Material not found');

  // Order with valid refs — should work
  const r3 = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5 });
  check('CREATE order with valid refs', r3.status, 201);
  const ordId = r3.data.data._id;

  // Update order with fake assignedTo
  const r4 = await api('PATCH', `/api/orders/${ordId}`, token, { assignedTo: fakeId });
  check('UPDATE order with fake assignedTo', r4.status, 400);
  checkIncludes('  message says Worker', r4.data.message, 'Worker (assignedTo) not found');

  // Claim with fake order
  const r5 = await api('POST', `/api/orders/${fakeId}/claims`, token, {
    source: 'worker', material: matId, description: 'Test', reportedBy: fakeId,
  });
  check('CREATE claim with fake order', r5.status, 400);
  checkIncludes('  message says Order', r5.data.message, 'Order not found');

  // Request with fake customer
  const r6 = await api('POST', '/api/requests', token, { details: { type: 'cut', quantity: 5 }, customer: fakeId });
  check('CREATE request with fake customer', r6.status, 400);
  checkIncludes('  message says Customer', r6.data.message, 'Customer not found');

  // Inventory with fake material
  const r7 = await api('POST', '/api/inventories', token, { material: fakeId, stockType: 'Raw', quantity: 50, location: 'WH' });
  check('CREATE inventory with fake material', r7.status, 400);
  checkIncludes('  message says Material', r7.data.message, 'Material not found');

  // MaterialLog with fake material
  const r8 = await api('POST', '/api/material-logs', token, { material: fakeId, actionType: 'import', quantityChanged: 10 });
  check('CREATE materialLog with fake material', r8.status, 400);
  checkIncludes('  message says Material', r8.data.message, 'Material not found');

  // Notification with fake recipient
  const r9 = await api('POST', '/api/notifications', token, { recipient: fakeId, type: 'info', title: 'Test' });
  check('CREATE notification with fake recipient', r9.status, 400);
  checkIncludes('  message says Recipient', r9.data.message, 'Recipient (Worker) not found');

  // Withdrawal with fake material
  const r10 = await api('POST', '/api/withdrawals', token, { withdrawnBy: fakeId, material: fakeId, quantity: 1, stockType: 'Raw' });
  check('CREATE withdrawal with fake material', r10.status, 400);

  // Station with fake templateId
  const r11 = await api('POST', '/api/stations', token, { name: 'Fake Station', templateId: fakeId });
  check('CREATE station with fake templateId', r11.status, 400);
  checkIncludes('  message says Station template', r11.data.message, 'Station template not found');

  // Station with valid templateId
  const tmpl = await api('POST', '/api/station-templates', token, { name: 'Ref Template' });
  const tmplId = tmpl.data.data._id;
  const r12 = await api('POST', '/api/stations', token, { name: 'Valid Station', templateId: tmplId });
  check('CREATE station with valid templateId', r12.status, 201);
  const stationId = r12.data.data._id;

  // Update station with fake templateId
  const r13 = await api('PATCH', `/api/stations/${stationId}`, token, { templateId: fakeId });
  check('UPDATE station with fake templateId', r13.status, 400);
  checkIncludes('  message says Station template', r13.data.message, 'Station template not found');

  // Clean up — cascade handles station under template
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 3. INVENTORY DEDUCTION ON WITHDRAWAL
// ──────────────────────────────────────────────

async function testInventoryDeduction(token) {
  console.log('\n=== Inventory Deduction on Withdrawal ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  // Create material + inventory
  const mat = await api('POST', '/api/materials', token, { name: 'Deduct Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const inv = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'WH-A' });
  const invId = inv.data.data._id;

  // Withdraw 30 — inventory should drop to 70
  const r1 = await api('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 30, stockType: 'Raw' });
  check('CREATE withdrawal (30 from 100)', r1.status, 201);

  const inv1 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory after withdrawal', inv1.data.data.quantity, 70);
  const wdId1 = r1.data.data._id;

  // Withdraw 50 more — inventory should drop to 20
  const r2 = await api('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 50, stockType: 'Raw' });
  check('CREATE withdrawal (50 from 70)', r2.status, 201);

  const inv2 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory after second withdrawal', inv2.data.data.quantity, 20);
  const wdId2 = r2.data.data._id;

  // Try to withdraw 25 — should fail (only 20 left)
  const r3 = await api('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 25, stockType: 'Raw' });
  check('CREATE withdrawal (25 from 20) — insufficient', r3.status, 400);
  checkIncludes('  message mentions stock', r3.data.message, 'Insufficient');

  // Verify inventory unchanged after failed withdrawal
  const inv3 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory unchanged after failed withdrawal', inv3.data.data.quantity, 20);

  // Delete first withdrawal (30) — inventory should go back to 50
  const r4 = await api('DELETE', `/api/withdrawals/${wdId1}`, token);
  check('DELETE withdrawal (restore 30)', r4.status, 200);

  const inv4 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory after delete withdrawal', inv4.data.data.quantity, 50);

  // Update second withdrawal: change quantity from 50 to 10 — inventory should go from 50 to 90
  const r5 = await api('PATCH', `/api/withdrawals/${wdId2}`, token, { quantity: 10 });
  check('UPDATE withdrawal (50 → 10)', r5.status, 200);

  const inv5 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory after update withdrawal', inv5.data.data.quantity, 90);

  // Update withdrawal: change quantity from 10 to 101 — should fail (only 100 available after restore)
  const r6 = await api('PATCH', `/api/withdrawals/${wdId2}`, token, { quantity: 101 });
  check('UPDATE withdrawal (10 → 101) — insufficient', r6.status, 400);

  // Verify inventory unchanged after failed update
  const inv6 = await api('GET', `/api/inventories/${invId}`, token);
  check('  inventory unchanged after failed update', inv6.data.data.quantity, 90);

  // Test with Reuse stock type — should not affect Raw inventory
  const inv7 = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Reuse', quantity: 15, location: 'WH-B' });
  const invId7 = inv7.data.data._id;

  const r7 = await api('POST', '/api/withdrawals', token, { withdrawnBy: workerId, material: matId, quantity: 10, stockType: 'Reuse' });
  check('CREATE withdrawal (Reuse type)', r7.status, 201);
  const wdId3 = r7.data.data._id;

  const invRaw = await api('GET', `/api/inventories/${invId}`, token);
  check('  Raw inventory unchanged', invRaw.data.data.quantity, 90);

  const invReuse = await api('GET', `/api/inventories/${invId7}`, token);
  check('  Reuse inventory deducted', invReuse.data.data.quantity, 5);

  // Bulk delete remaining withdrawals — inventory should restore
  const r8 = await api('DELETE', '/api/withdrawals', token, { ids: [wdId2, wdId3] });
  check('DELETE MANY withdrawals', r8.status, 200);

  const invFinalRaw = await api('GET', `/api/inventories/${invId}`, token);
  check('  Raw inventory restored after bulk delete', invFinalRaw.data.data.quantity, 100);

  const invFinalReuse = await api('GET', `/api/inventories/${invId7}`, token);
  check('  Reuse inventory restored after bulk delete', invFinalReuse.data.data.quantity, 15);

  // Clean up everything we created
  await api('DELETE', `/api/inventories/${invId}`, token);
  await api('DELETE', `/api/inventories/${invId7}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
}

// ──────────────────────────────────────────────
// 4. MATERIALLOG CASCADE
// ──────────────────────────────────────────────

async function testMaterialLogCascade(token) {
  console.log('\n=== MaterialLog Cascade ===\n');

  const mat = await api('POST', '/api/materials', token, { name: 'Log Mat', unit: 'sheet', reorderPoint: 1 });
  const matId = mat.data.data._id;

  const parent = await api('POST', '/api/material-logs', token, { material: matId, actionType: 'import', quantityChanged: 100 });
  const parentId = parent.data.data._id;

  const child = await api('POST', '/api/material-logs', token, { material: matId, actionType: 'cut', quantityChanged: -10, parentLog: parentId });
  const childId = child.data.data._id;

  const r1 = await api('DELETE', `/api/material-logs/${parentId}`, token);
  check('DELETE parent log cascades child', r1.status, 200);
  const r1b = await api('GET', `/api/material-logs/${childId}`, token);
  check('  child log also deleted', r1b.status, 404);

  await api('DELETE', `/api/materials/${matId}`, token);
}

// ──────────────────────────────────────────────
// 5. REQUEST CASCADE
// ──────────────────────────────────────────────

async function testRequestCascade(token) {
  console.log('\n=== Request Cascade ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Req Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Req Mat', unit: 'pc', reorderPoint: 1 });
  const matId = mat.data.data._id;

  const req = await api('POST', '/api/requests', token, { details: { type: 'cut', quantity: 5 }, customer: custId });
  const reqId = req.data.data._id;

  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5, request: reqId });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, { request: reqId, order: ordId });
  const paneId = pane.data.data._id;

  const r1 = await api('DELETE', `/api/requests/${reqId}`, token);
  check('DELETE request cascades order + pane', r1.status, 200);
  const r1b = await api('GET', `/api/orders/${ordId}`, token);
  check('  order also deleted', r1b.status, 404);
  const r1c = await api('GET', `/api/panes/${paneId}`, token);
  check('  pane also deleted', r1c.status, 404);

  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 6. STATION TEMPLATE CASCADE
// ──────────────────────────────────────────────

async function testStationTemplateCascade(token) {
  console.log('\n=== Station Template Cascade ===\n');

  const tmpl = await api('POST', '/api/station-templates', token, { name: 'Cascade Template', uiSchema: { test: true } });
  const tmplId = tmpl.data.data._id;

  const station = await api('POST', '/api/stations', token, { name: 'Cascade Station', templateId: tmplId });
  const stationId = station.data.data._id;

  const r1 = await api('DELETE', `/api/station-templates/${tmplId}`, token);
  check('DELETE template cascades station', r1.status, 200);
  const r1b = await api('GET', `/api/stations/${stationId}`, token);
  check('  station also deleted', r1b.status, 404);

  // Bulk delete with refs
  const tmpl2 = await api('POST', '/api/station-templates', token, { name: 'Bulk A' });
  const tmpl3 = await api('POST', '/api/station-templates', token, { name: 'Bulk B' });
  const tmplId2 = tmpl2.data.data._id;
  const tmplId3 = tmpl3.data.data._id;

  const station2 = await api('POST', '/api/stations', token, { name: 'Ref Station', templateId: tmplId2 });
  const stationId2 = station2.data.data._id;

  const r2 = await api('DELETE', '/api/station-templates', token, { ids: [tmplId2, tmplId3] });
  check('DELETE MANY templates cascades stations', r2.status, 200);
  const r2b = await api('GET', `/api/stations/${stationId2}`, token);
  check('  station also deleted', r2b.status, 404);
}

// ──────────────────────────────────────────────
// 6b. STATION colorId FIELD
// ──────────────────────────────────────────────

async function testStationColorId(token) {
  console.log('\n=== Station colorId Field ===\n');

  const tmpl = await api('POST', '/api/station-templates', token, { name: 'Color Template' });
  const tmplId = tmpl.data.data._id;

  // Create station with colorId
  const r1 = await api('POST', '/api/stations', token, { name: 'Pink Station', templateId: tmplId, colorId: 'pink' });
  check('CREATE station with colorId', r1.status, 201);
  const stationId = r1.data.data._id;
  check('  colorId persisted', r1.data.data.colorId, 'pink');

  // Create station without colorId — should default to "sky"
  const r2 = await api('POST', '/api/stations', token, { name: 'Default Station', templateId: tmplId });
  check('CREATE station without colorId (default)', r2.status, 201);
  const stationId2 = r2.data.data._id;
  check('  default colorId is sky', r2.data.data.colorId, 'sky');

  // GET by ID — colorId present
  const r3 = await api('GET', `/api/stations/${stationId}`, token);
  check('GET station includes colorId', r3.data.data.colorId, 'pink');

  // GET all — colorId present
  const r4 = await api('GET', '/api/stations', token);
  const found = r4.data.data.find((s) => s._id === stationId);
  check('GET all includes colorId', found?.colorId, 'pink');

  // UPDATE colorId
  const r5 = await api('PATCH', `/api/stations/${stationId}`, token, { colorId: 'teal' });
  check('UPDATE station colorId', r5.status, 200);
  check('  colorId updated', r5.data.data.colorId, 'teal');
  check('  name preserved', r5.data.data.name, 'Pink Station');

  // UPDATE with invalid colorId — should fail validation
  const r6 = await api('PATCH', `/api/stations/${stationId}`, token, { colorId: 'rainbow' });
  check('UPDATE with invalid colorId', r6.status, 400);

  // CREATE with invalid colorId — should fail validation
  const r7 = await api('POST', '/api/stations', token, { name: 'Bad Station', templateId: tmplId, colorId: 'neon' });
  check('CREATE with invalid colorId', r7.status, 400);

  // Clean up
  await api('DELETE', `/api/stations/${stationId}`, token);
  await api('DELETE', `/api/stations/${stationId2}`, token);
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
}

// ──────────────────────────────────────────────
// 7. NOTIFICATION PREFERENCES VALIDATION
// ──────────────────────────────────────────────

async function testNotificationPreferences(token, roleIds) {
  console.log('\n=== Notification Preferences Validation ===\n');

  // Defaults are applied on worker creation
  const w = await api('POST', '/api/workers', token, {
    name: 'Prefs Test', username: 'prefs_test', password: 'prefs123456', position: 'tester', role: roleIds.worker,
  });
  check('CREATE worker has default notifPrefs', w.status, 201);
  const wId = w.data.data._id;
  const prefs = w.data.data.notificationPreferences;
  check('  default enabled', prefs.enabled, true);
  check('  default volume', prefs.volume, 0.6);
  check('  default sounds.low', prefs.sounds.low, 'soft_pop');
  check('  default sounds.medium', prefs.sounds.medium, 'ding');
  check('  default sounds.high', prefs.sounds.high, 'alert');
  check('  default sounds.urgent', prefs.sounds.urgent, 'alert');

  // Volume out of range — should fail validation (> 1)
  const r1 = await api('PATCH', `/api/workers/${wId}`, token, {
    notificationPreferences: { volume: 1.5 },
  });
  check('UPDATE notifPrefs volume > 1', r1.status, 400);

  // Volume out of range — should fail validation (< 0)
  const r2 = await api('PATCH', `/api/workers/${wId}`, token, {
    notificationPreferences: { volume: -0.5 },
  });
  check('UPDATE notifPrefs volume < 0', r2.status, 400);

  // Valid edge values
  const r3 = await api('PATCH', `/api/workers/${wId}`, token, {
    notificationPreferences: { volume: 0 },
  });
  check('UPDATE notifPrefs volume = 0 (mute)', r3.status, 200);

  const r4 = await api('PATCH', `/api/workers/${wId}`, token, {
    notificationPreferences: { volume: 1 },
  });
  check('UPDATE notifPrefs volume = 1 (max)', r4.status, 200);

  // Admin can create worker with custom notifPrefs
  const w2 = await api('POST', '/api/workers', token, {
    name: 'Custom Prefs', username: 'custom_prefs', password: 'custom123456', position: 'tester', role: roleIds.worker,
    notificationPreferences: { enabled: false, volume: 0.1, sounds: { low: 'chime' } },
  });
  check('CREATE worker with custom notifPrefs', w2.status, 201);
  const w2Id = w2.data.data._id;
  check('  custom enabled', w2.data.data.notificationPreferences.enabled, false);
  check('  custom volume', w2.data.data.notificationPreferences.volume, 0.1);
  check('  custom sounds.low', w2.data.data.notificationPreferences.sounds.low, 'chime');

  // Partial update via PATCH /auth/me — login as the worker
  // (Only admin test here since worker login needs password)
  const r5 = await api('PATCH', `/api/workers/${wId}`, token, {
    notificationPreferences: { sounds: { medium: 'bell' } },
  });
  check('UPDATE partial sounds via admin', r5.status, 200);

  const r6 = await api('GET', `/api/workers/${wId}`, token);
  check('  sounds.medium updated', r6.data.data.notificationPreferences.sounds.medium, 'bell');
  check('  volume preserved', r6.data.data.notificationPreferences.volume, 1);

  // Clean up
  await api('DELETE', `/api/workers/${wId}`, token);
  await api('DELETE', `/api/workers/${w2Id}`, token);
}

// ──────────────────────────────────────────────
// 8. ORDER NEW FIELDS (currentStationIndex, stationHistory, stationData, notes)
// ──────────────────────────────────────────────

async function testOrderNewFields(token, stns) {
  console.log('\n=== Order New Fields (currentStationIndex, stationHistory, stationData, notes) ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const mat = await api('POST', '/api/materials', token, { name: 'Station Flow Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'Station Flow Customer' });
  const custId = cust.data.data._id;

  const enteredAt0 = new Date().toISOString();
  // Create order with new fields
  const r1 = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 10,
    stations: [stns.cutting, stns.polishing, stns.inspection],
    currentStationIndex: 0,
    stationHistory: [
      { station: stns.cutting, enteredAt: enteredAt0, completedBy: workerId },
    ],
    stationData: { [stns.cutting]: { temperature: 350, blade: 'diamond' } },
    notes: 'Rush order — customer VIP',
  });
  check('CREATE order with new fields', r1.status, 201);
  const ordId = r1.data.data._id;

  // Verify fields persisted
  const r2 = await api('GET', `/api/orders/${ordId}`, token);
  check('  currentStationIndex persisted', r2.data.data.currentStationIndex, 0);
  check('  stationHistory length', r2.data.data.stationHistory.length, 1);
  check('  stationHistory[0].station id', stationRefId(r2.data.data.stationHistory[0].station), String(stns.cutting));
  check('  stationData cutting exists', r2.data.data.stationData[stns.cutting] !== undefined, true);
  check('  stationData cutting temperature', r2.data.data.stationData[stns.cutting].temperature, 350);
  check('  notes persisted', r2.data.data.notes, 'Rush order — customer VIP');

  // Update: advance station, add history entry, add stationData (send plain ObjectIds, not populated refs)
  const r3 = await api('PATCH', `/api/orders/${ordId}`, token, {
    currentStationIndex: 1,
    stationHistory: [
      { station: stns.cutting, enteredAt: enteredAt0, completedBy: workerId },
      { station: stns.polishing, enteredAt: new Date().toISOString() },
    ],
    stationData: {
      ...r2.data.data.stationData,
      [stns.polishing]: { grit: 400, passes: 3 },
    },
    notes: 'Rush order — customer VIP. Polishing started.',
  });
  check('UPDATE order advance station', r3.status, 200);

  const r4 = await api('GET', `/api/orders/${ordId}`, token);
  check('  currentStationIndex updated', r4.data.data.currentStationIndex, 1);
  check('  stationHistory length after update', r4.data.data.stationHistory.length, 2);
  check('  stationHistory[1].station id', stationRefId(r4.data.data.stationHistory[1].station), String(stns.polishing));
  check('  stationData polishing grit', r4.data.data.stationData[stns.polishing].grit, 400);
  check('  stationData cutting preserved', r4.data.data.stationData[stns.cutting].temperature, 350);
  checkIncludes('  notes updated', r4.data.data.notes, 'Polishing started');

  // Create order with defaults — new fields should have sensible defaults
  const r5 = await api('POST', '/api/orders', token, {
    customer: custId,
    material: matId,
    quantity: 1,
  });
  check('CREATE order without new fields (defaults)', r5.status, 201);
  const ordId2 = r5.data.data._id;

  const r6 = await api('GET', `/api/orders/${ordId2}`, token);
  check('  default currentStationIndex', r6.data.data.currentStationIndex, 0);
  check('  default stationHistory empty', r6.data.data.stationHistory.length, 0);
  check('  default notes empty', r6.data.data.notes, '');

  // Clean up
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/orders/${ordId2}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 9. WITHDRAWAL NOTES FIELD
// ──────────────────────────────────────────────

async function testWithdrawalNotes(token) {
  console.log('\n=== Withdrawal Notes Field ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const mat = await api('POST', '/api/materials', token, { name: 'Notes Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const inv = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'WH' });
  const invId = inv.data.data._id;

  // Create withdrawal with notes
  const r1 = await api('POST', '/api/withdrawals', token, {
    withdrawnBy: workerId,
    material: matId,
    quantity: 5,
    stockType: 'Raw',
    notes: 'Needed for urgent repair job',
  });
  check('CREATE withdrawal with notes', r1.status, 201);
  const wdId = r1.data.data._id;
  check('  notes persisted', r1.data.data.notes, 'Needed for urgent repair job');

  // Update notes
  const r2 = await api('PATCH', `/api/withdrawals/${wdId}`, token, {
    notes: 'Updated: repair completed, leftover returned',
  });
  check('UPDATE withdrawal notes', r2.status, 200);

  const r3 = await api('GET', `/api/withdrawals/${wdId}`, token);
  check('  notes updated', r3.data.data.notes, 'Updated: repair completed, leftover returned');

  // Create withdrawal without notes — should default to empty
  const r4 = await api('POST', '/api/withdrawals', token, {
    withdrawnBy: workerId,
    material: matId,
    quantity: 3,
    stockType: 'Raw',
  });
  check('CREATE withdrawal without notes (default)', r4.status, 201);
  const wdId2 = r4.data.data._id;
  check('  default notes empty', r4.data.data.notes, '');

  // Clean up
  await api('DELETE', `/api/withdrawals/${wdId}`, token);
  await api('DELETE', `/api/withdrawals/${wdId2}`, token);
  await api('DELETE', `/api/inventories/${invId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
}

// ──────────────────────────────────────────────
// 10. REQUEST AUTO-NUMBERING
// ──────────────────────────────────────────────

async function testRequestNumbering(token) {
  console.log('\n=== Request Auto-Numbering ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Numbering Cust' });
  const custId = cust.data.data._id;

  // Create first request — should get a requestNumber
  const r1 = await api('POST', '/api/requests', token, { details: { type: 'cut', quantity: 5 }, customer: custId });
  check('CREATE request has requestNumber', r1.status, 201);
  const num1 = r1.data.data.requestNumber;
  check('  requestNumber is a string', typeof num1, 'string');
  check('  requestNumber starts with REQ-', num1.startsWith('REQ-'), true);
  console.log(`          got: ${num1}`);

  // Create second request — should get a different (incremented) number
  const r2 = await api('POST', '/api/requests', token, { details: { type: 'polish', quantity: 3 }, customer: custId });
  check('CREATE second request has requestNumber', r2.status, 201);
  const num2 = r2.data.data.requestNumber;
  check('  requestNumber is different from first', num1 !== num2, true);
  console.log(`          got: ${num2}`);

  // Verify the number is sequential (second > first)
  const seq1 = parseInt(num1.split('-')[1]);
  const seq2 = parseInt(num2.split('-')[1]);
  check('  second number is sequential', seq2, seq1 + 1);

  // GET should include requestNumber
  const r3 = await api('GET', `/api/requests/${r1.data.data._id}`, token);
  check('GET request includes requestNumber', r3.data.data.requestNumber, num1);

  // GET all should include requestNumber
  const r4 = await api('GET', '/api/requests?limit=100', token);
  const withNumbers = r4.data.data.filter((r) => r.requestNumber);
  check('GET all — created requests have requestNumber', withNumbers.length >= 2, true);

  // Update should NOT change requestNumber
  const r5 = await api('PATCH', `/api/requests/${r1.data.data._id}`, token, { deliveryLocation: 'Updated' });
  check('UPDATE does not change requestNumber', r5.data.data.requestNumber, num1);

  // Clean up
  await api('DELETE', `/api/requests/${r1.data.data._id}`, token);
  await api('DELETE', `/api/requests/${r2.data.data._id}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 11. ORDER AUTO-NUMBERING
// ──────────────────────────────────────────────

async function testOrderNumbering(token) {
  console.log('\n=== Order Auto-Numbering ===\n');

  const mat = await api('POST', '/api/materials', token, { name: 'OrdNum Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'OrdNum Cust' });
  const custId = cust.data.data._id;

  // Create first order — should get an orderNumber
  const r1 = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5 });
  check('CREATE order has orderNumber', r1.status, 201);
  const num1 = r1.data.data.orderNumber;
  check('  orderNumber is a string', typeof num1, 'string');
  check('  orderNumber starts with ORD-', num1.startsWith('ORD-'), true);
  console.log(`          got: ${num1}`);

  // Create second order — should get a different (incremented) number
  const r2 = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 3 });
  check('CREATE second order has orderNumber', r2.status, 201);
  const num2 = r2.data.data.orderNumber;
  check('  orderNumber is different from first', num1 !== num2, true);
  console.log(`          got: ${num2}`);

  // Verify sequential
  const seq1 = parseInt(num1.split('-')[1]);
  const seq2 = parseInt(num2.split('-')[1]);
  check('  second number is sequential', seq2, seq1 + 1);

  // GET should include orderNumber
  const r3 = await api('GET', `/api/orders/${r1.data.data._id}`, token);
  check('GET order includes orderNumber', r3.data.data.orderNumber, num1);

  // Update should NOT change orderNumber
  const r4 = await api('PATCH', `/api/orders/${r1.data.data._id}`, token, { notes: 'Updated' });
  check('UPDATE does not change orderNumber', r4.data.data.orderNumber, num1);

  // Clean up
  await api('DELETE', `/api/orders/${r1.data.data._id}`, token);
  await api('DELETE', `/api/orders/${r2.data.data._id}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 12. CLAIM AUTO-NUMBERING
// ──────────────────────────────────────────────

async function testClaimNumbering(token) {
  console.log('\n=== Claim Auto-Numbering ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const mat = await api('POST', '/api/materials', token, { name: 'ClmNum Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'ClmNum Cust' });
  const custId = cust.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5 });
  const ordId = ord.data.data._id;

  // Create first claim — should get a claimNumber
  const r1 = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'worker', material: matId, description: 'Claim 1', reportedBy: workerId,
  });
  check('CREATE claim has claimNumber', r1.status, 201);
  const num1 = r1.data.data.claimNumber;
  check('  claimNumber is a string', typeof num1, 'string');
  check('  claimNumber starts with CLM-', num1.startsWith('CLM-'), true);
  console.log(`          got: ${num1}`);

  // Create second claim — should get a different (incremented) number
  const r2 = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'customer', material: matId, description: 'Claim 2', reportedBy: workerId,
  });
  check('CREATE second claim has claimNumber', r2.status, 201);
  const num2 = r2.data.data.claimNumber;
  check('  claimNumber is different from first', num1 !== num2, true);
  console.log(`          got: ${num2}`);

  // Verify sequential
  const seq1 = parseInt(num1.split('-')[1]);
  const seq2 = parseInt(num2.split('-')[1]);
  check('  second number is sequential', seq2, seq1 + 1);

  // GET should include claimNumber
  const r3 = await api('GET', `/api/claims/${r1.data.data._id}`, token);
  check('GET claim includes claimNumber', r3.data.data.claimNumber, num1);

  // Update should NOT change claimNumber
  const r4 = await api('PATCH', `/api/claims/${r1.data.data._id}`, token, { description: 'Updated' });
  check('UPDATE does not change claimNumber', r4.data.data.claimNumber, num1);

  // Clean up — deleting order cascades claims
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 12b. CLAIM FROM PANE + PHOTOS
// ──────────────────────────────────────────────

async function testClaimFromPane(token) {
  console.log('\n=== Claim From Pane + Photos ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const mat = await api('POST', '/api/materials', token, { name: 'ClaimPane Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'ClaimPane Cust' });
  const custId = cust.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5 });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, { order: ordId, material: matId });
  const paneNumber = pane.data.data.paneNumber;
  const paneId = pane.data.data._id;

  // Create claim from pane number
  const r1 = await api('POST', '/api/claims/from-pane', token, {
    paneNumber,
    source: 'worker',
    description: 'Defect found via scan',
    defectCode: 'scratch',
    reportedBy: workerId,
    photos: ['https://example.com/photo1.jpg', 'https://example.com/photo2.jpg'],
  });
  check('CREATE claim from pane', r1.status, 201);
  check('  order auto-resolved', r1.data.data.order._id || r1.data.data.order, ordId);
  check('  material auto-resolved', r1.data.data.material._id || r1.data.data.material, matId);
  check('  pane linked', r1.data.data.pane._id || r1.data.data.pane, paneId);
  check('  has claimNumber', typeof r1.data.data.claimNumber, 'string');
  check('  photos array length', r1.data.data.photos.length, 2);
  check('  photo URL correct', r1.data.data.photos[0], 'https://example.com/photo1.jpg');

  // Create claim from fake pane number
  const r2 = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: 'PNE-9999',
    source: 'worker',
    description: 'Fake pane',
    reportedBy: workerId,
  });
  check('CREATE claim from fake pane', r2.status, 404);

  // Photos on regular claim create (via order)
  const r3 = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'customer', material: matId, description: 'With photos', reportedBy: workerId,
    photos: ['https://example.com/defect.jpg'],
  });
  check('CREATE regular claim with photos', r3.status, 201);
  check('  photos included', r3.data.data.photos.length, 1);

  // Claim without photos defaults to empty array
  const r4 = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'customer', material: matId, description: 'No photos', reportedBy: workerId,
  });
  check('CREATE claim without photos', r4.status, 201);
  check('  photos defaults to empty', r4.data.data.photos.length, 0);

  // Update claim photos
  const r5 = await api('PATCH', `/api/claims/${r4.data.data._id}`, token, {
    photos: ['https://example.com/added.jpg'],
  });
  check('UPDATE claim photos', r5.status, 200);
  check('  photos updated', r5.data.data.photos.length, 1);

  // Clean up
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 13. PANE AUTO-NUMBERING + QR CODE
// ──────────────────────────────────────────────

async function testPaneNumbering(token, stns) {
  console.log('\n=== Pane Auto-Numbering + QR Code ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'PaneNum Cust' });
  const custId = cust.data.data._id;
  const reqRes = await api('POST', '/api/requests', token, { customer: custId, details: { type: 'tempered', quantity: 5 } });
  const reqId = reqRes.data.data._id;

  const r1 = await api('POST', '/api/panes', token, {
    request: reqId, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered',
  });
  check('CREATE pane has paneNumber', r1.status, 201);
  const num1 = r1.data.data.paneNumber;
  check('  paneNumber is a string', typeof num1, 'string');
  check('  paneNumber starts with PNE-', num1.startsWith('PNE-'), true);
  console.log(`          got: ${num1}`);

  const qr1 = r1.data.data.qrCode;
  check('  qrCode is a string', typeof qr1, 'string');
  check('  qrCode starts with STDPLUS:', qr1.startsWith('STDPLUS:'), true);
  check('  qrCode matches paneNumber', qr1, `STDPLUS:${num1}`);
  console.log(`          qrCode: ${qr1}`);

  const r2 = await api('POST', '/api/panes', token, { request: reqId });
  check('CREATE second pane has paneNumber', r2.status, 201);
  const num2 = r2.data.data.paneNumber;
  check('  paneNumber is different', num1 !== num2, true);
  console.log(`          got: ${num2}`);

  const seq1 = parseInt(num1.split('-')[1]);
  const seq2 = parseInt(num2.split('-')[1]);
  check('  second number is sequential', seq2, seq1 + 1);

  const r3 = await api('GET', `/api/panes/${r1.data.data._id}`, token);
  check('GET pane includes paneNumber', r3.data.data.paneNumber, num1);
  check('GET pane includes qrCode', r3.data.data.qrCode, qr1);

  const r4 = await api('PATCH', `/api/panes/${r1.data.data._id}`, token, { currentStation: stns.cutting });
  check('UPDATE does not change paneNumber', r4.data.data.paneNumber, num1);
  check('UPDATE does not change qrCode', r4.data.data.qrCode, qr1);
  check('  currentStation id set', stationRefId(r4.data.data.currentStation), String(stns.cutting));

  await api('DELETE', `/api/panes/${r1.data.data._id}`, token);
  await api('DELETE', `/api/panes/${r2.data.data._id}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 14. PANE CASCADE DELETE
// ──────────────────────────────────────────────

async function testPaneCascade(token, stns) {
  console.log('\n=== Pane Cascade Delete ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const mat = await api('POST', '/api/materials', token, { name: 'PaneCasc Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'PaneCasc Cust' });
  const custId = cust.data.data._id;
  const reqRes = await api('POST', '/api/requests', token, { customer: custId, details: { type: 'tempered', quantity: 1 } });
  const reqId = reqRes.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1, request: reqId });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, { request: reqId, order: ordId });
  const paneId = pane.data.data._id;

  const log = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.cutting, action: 'scan_in', operator: workerId,
  });
  const logId = log.data.data._id;

  // Pane with production log → cascade deletes it
  const r1 = await api('DELETE', `/api/panes/${paneId}`, token);
  check('DELETE pane cascades production log', r1.status, 200);
  const r1b = await api('GET', `/api/production-logs/${logId}`, token);
  check('  production log also deleted', r1b.status, 404);

  // Request with order → cascade deletes everything
  const pane2 = await api('POST', '/api/panes', token, { request: reqId, order: ordId });
  const pane2Id = pane2.data.data._id;

  const r2 = await api('DELETE', `/api/requests/${reqId}`, token);
  check('DELETE request cascades order + pane', r2.status, 200);
  const r2b = await api('GET', `/api/orders/${ordId}`, token);
  check('  order also deleted', r2b.status, 404);
  const r2c = await api('GET', `/api/panes/${pane2Id}`, token);
  check('  pane also deleted', r2c.status, 404);

  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 15. PANE + PRODUCTION LOG REFERENTIAL CHECKS
// ──────────────────────────────────────────────

async function testPaneReferentialChecks(token, stns) {
  console.log('\n=== Pane + ProductionLog Referential Checks ===\n');

  const fakeId = '000000000000000000000000';

  // Create pane with fake request
  const r0 = await api('POST', '/api/panes', token, { request: fakeId });
  check('CREATE pane with fake request', r0.status, 400);
  checkIncludes('  message says Request', r0.data.message, 'Request not found');

  // Create valid request + pane (no order yet)
  const mat = await api('POST', '/api/materials', token, { name: 'PaneRef Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'PaneRef Cust' });
  const custId = cust.data.data._id;
  const reqRes = await api('POST', '/api/requests', token, { customer: custId, details: { type: 'tempered', quantity: 1 } });
  const reqId = reqRes.data.data._id;

  const pane = await api('POST', '/api/panes', token, { request: reqId });
  check('CREATE pane with valid request (no order)', pane.status, 201);
  const paneId = pane.data.data._id;
  check('  pane.order is null', pane.data.data.order, null);
  check('  pane.request is set', !!pane.data.data.request, true);

  // Create order from request → panes get backfilled
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1, request: reqId });
  const ordId = ord.data.data._id;
  check('CREATE order from request', ord.status, 201);

  const paneAfter = await api('GET', `/api/panes/${paneId}`, token);
  check('  pane.order backfilled after order created', !!paneAfter.data.data.order, true);
  const backfilledMat = paneAfter.data.data.material;
  check('  pane.material backfilled after order created', String(backfilledMat?._id || backfilledMat), String(matId));

  // Create production log with fake pane
  const r2 = await api('POST', '/api/production-logs', token, {
    pane: fakeId, order: ordId, station: stns.cutting, action: 'scan_in',
  });
  check('CREATE production-log with fake pane', r2.status, 400);
  checkIncludes('  message says Pane', r2.data.message, 'Pane not found');

  // Create production log with fake order
  const r3 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: fakeId, station: stns.cutting, action: 'scan_in',
  });
  check('CREATE production-log with fake order', r3.status, 400);
  checkIncludes('  message says Order', r3.data.message, 'Order not found');

  // Create valid production log
  const r4 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.cutting, action: 'scan_in',
  });
  check('CREATE production-log with valid refs', r4.status, 201);

  // Clean up — cascade deletes handle children automatically
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 16. REQUEST WITH INLINE PANES
// ──────────────────────────────────────────────

async function testRequestWithPanes(token) {
  console.log('\n=== Request with Inline Panes ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'InlinePane Cust' });
  const custId = cust.data.data._id;

  const r1 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 3 },
    panes: [
      { dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered' },
      { dimensions: { width: 1000, height: 500, thickness: 6 }, glassType: 'laminated' },
      { dimensions: { width: 600, height: 400, thickness: 4 }, glassType: 'tempered' },
    ],
  });
  check('CREATE request with panes', r1.status, 201);
  check('  response includes panes array', Array.isArray(r1.data.data.panes), true);
  check('  panes count matches', r1.data.data.panes.length, 3);

  const reqId = r1.data.data._id;
  const pane1 = r1.data.data.panes[0];
  const pane2 = r1.data.data.panes[1];
  const pane3 = r1.data.data.panes[2];

  check('  pane 1 has paneNumber', !!pane1.paneNumber, true);
  check('  pane 1 has qrCode', !!pane1.qrCode, true);
  check('  pane 1 linked to request', pane1.request.toString(), reqId);
  check('  pane 1 order is null', pane1.order, null);
  check('  pane 2 has different paneNumber', pane1.paneNumber !== pane2.paneNumber, true);

  // Verify panes via GET
  const paneGet = await api('GET', `/api/panes/${pane1._id}`, token);
  check('  GET pane linked to request', paneGet.status, 200);

  // Create request without panes (still works)
  const r2 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
  });
  check('CREATE request without panes', r2.status, 201);
  check('  no panes property', r2.data.data.panes, undefined);

  // Clean up — cascade deletes handle panes automatically
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/requests/${r2.data.data._id}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 16b. PANE jobType + rawGlass FIELDS
// ──────────────────────────────────────────────

async function testPaneNewFields(token) {
  console.log('\n=== Pane jobType + rawGlass Fields ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'PaneFields Cust' });
  const custId = cust.data.data._id;
  const reqRes = await api('POST', '/api/requests', token, { customer: custId, details: { type: 'tempered', quantity: 1 } });
  const reqId = reqRes.data.data._id;

  const sampleHoles = [
    { id: 'h1', type: 'circle', x: 100, y: 200, diameter: 10 },
    { id: 'h2', type: 'circle', x: 300, y: 400, diameter: 15 },
    { id: 'h3', type: 'rectangle', x: 500, y: 100, width: 20, height: 30 },
    { id: 'h4', type: 'slot', x: 700, y: 300, width: 10, length: 50 },
  ];
  const sampleNotches = [
    { id: 'n1', type: 'rectangle', x: 50, y: 0, width: 20, height: 30 },
    { id: 'n2', type: 'custom', x: 150, y: 0, vertices: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 30 }] },
  ];

  // Create pane with jobType + rawGlass + holes + notches + cornerSpec + dimensionTolerance
  const r1 = await api('POST', '/api/panes', token, {
    request: reqId,
    dimensions: { width: 800, height: 600, thickness: 5 },
    jobType: 'Laminated',
    rawGlass: { glassType: 'Clear', color: 'เขียว', thickness: 5, sheetsPerPane: 2 },
    holes: sampleHoles,
    notches: sampleNotches,
    cornerSpec: 'chamfer 3mm',
    dimensionTolerance: '±1mm',
  });
  check('CREATE pane with jobType + rawGlass + holes + notches', r1.status, 201);
  const paneId = r1.data.data._id;
  check('  jobType persisted', r1.data.data.jobType, 'Laminated');
  check('  rawGlass.glassType', r1.data.data.rawGlass.glassType, 'Clear');
  check('  rawGlass.color', r1.data.data.rawGlass.color, 'เขียว');
  check('  rawGlass.thickness', r1.data.data.rawGlass.thickness, 5);
  check('  rawGlass.sheetsPerPane', r1.data.data.rawGlass.sheetsPerPane, 2);
  check('  holes count', r1.data.data.holes.length, 4);
  check('  holes[0].id', r1.data.data.holes[0].id, 'h1');
  check('  holes[0].type', r1.data.data.holes[0].type, 'circle');
  check('  holes[0].diameter', r1.data.data.holes[0].diameter, 10);
  check('  notches count', r1.data.data.notches.length, 2);
  check('  notches[0].id', r1.data.data.notches[0].id, 'n1');
  check('  cornerSpec persisted', r1.data.data.cornerSpec, 'chamfer 3mm');
  check('  dimensionTolerance persisted', r1.data.data.dimensionTolerance, '±1mm');

  // GET — verify persistence
  const r2 = await api('GET', `/api/panes/${paneId}`, token);
  check('GET pane jobType', r2.data.data.jobType, 'Laminated');
  check('  rawGlass.glassType', r2.data.data.rawGlass.glassType, 'Clear');
  check('  rawGlass.sheetsPerPane', r2.data.data.rawGlass.sheetsPerPane, 2);
  check('  holes count', r2.data.data.holes.length, 4);
  check('  notches count', r2.data.data.notches.length, 2);
  check('  cornerSpec persisted', r2.data.data.cornerSpec, 'chamfer 3mm');
  check('  dimensionTolerance persisted', r2.data.data.dimensionTolerance, '±1mm');

  // UPDATE — change jobType, rawGlass, holes, notches
  const updatedHoles = [
    { id: 'h10', type: 'circle', x: 50, y: 50, diameter: 8 },
    { id: 'h11', type: 'circle', x: 150, y: 150, diameter: 12 },
  ];
  const updatedNotches = [
    { id: 'n10', type: 'rectangle', x: 0, y: 50, width: 25, height: 40 },
    { id: 'n11', type: 'rectangle', x: 0, y: 150, width: 25, height: 40 },
    { id: 'n12', type: 'custom', x: 0, y: 250, vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
  ];
  const r3 = await api('PATCH', `/api/panes/${paneId}`, token, {
    jobType: 'Tempered',
    rawGlass: { glassType: 'Tinted', color: 'ชา', thickness: 10, sheetsPerPane: 1 },
    holes: updatedHoles,
    notches: updatedNotches,
    cornerSpec: 'radius 5mm',
    dimensionTolerance: '±2mm',
  });
  check('UPDATE pane jobType', r3.status, 200);
  check('  jobType updated', r3.data.data.jobType, 'Tempered');
  check('  rawGlass.glassType updated', r3.data.data.rawGlass.glassType, 'Tinted');
  check('  rawGlass.color updated', r3.data.data.rawGlass.color, 'ชา');
  check('  rawGlass.thickness updated', r3.data.data.rawGlass.thickness, 10);
  check('  rawGlass.sheetsPerPane updated', r3.data.data.rawGlass.sheetsPerPane, 1);
  check('  holes updated count', r3.data.data.holes.length, 2);
  check('  notches updated count', r3.data.data.notches.length, 3);
  check('  cornerSpec updated', r3.data.data.cornerSpec, 'radius 5mm');
  check('  dimensionTolerance updated', r3.data.data.dimensionTolerance, '±2mm');

  // CREATE pane without new fields — should get defaults
  const r4 = await api('POST', '/api/panes', token, { request: reqId });
  check('CREATE pane without new fields (defaults)', r4.status, 201);
  const paneId2 = r4.data.data._id;
  check('  default jobType is empty', r4.data.data.jobType, '');
  check('  default rawGlass.glassType is empty', r4.data.data.rawGlass.glassType, '');
  check('  default rawGlass.color is empty', r4.data.data.rawGlass.color, '');
  check('  default rawGlass.thickness is 0', r4.data.data.rawGlass.thickness, 0);
  check('  default rawGlass.sheetsPerPane is 1', r4.data.data.rawGlass.sheetsPerPane, 1);
  check('  default holes is empty array', r4.data.data.holes.length, 0);
  check('  default notches is empty array', r4.data.data.notches.length, 0);
  check('  default cornerSpec is empty', r4.data.data.cornerSpec, '');
  check('  default dimensionTolerance is empty', r4.data.data.dimensionTolerance, '');

  // Inline panes via request — with jobType + rawGlass + holes + notches
  const inlineHoles = [{ id: 'ih1', type: 'circle', x: 100, y: 100, diameter: 12 }, { id: 'ih2', type: 'circle', x: 200, y: 200, diameter: 8 }];
  const inlineNotches = [{ id: 'in1', type: 'rectangle', x: 0, y: 50, width: 15, height: 20 }];
  const inlineNotches2 = [
    { id: 'in2a', type: 'rectangle', x: 0, y: 30, width: 10, height: 15 },
    { id: 'in2b', type: 'rectangle', x: 0, y: 100, width: 10, height: 15 },
    { id: 'in2c', type: 'custom', x: 50, y: 0, vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
  ];
  const reqRes2 = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 2 },
    panes: [
      { jobType: 'Laminated', rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 2 }, holes: inlineHoles, notches: inlineNotches, cornerSpec: 'flat', dimensionTolerance: '±0.5mm' },
      { jobType: 'Tempered', rawGlass: { glassType: 'Tinted', color: 'เทา', thickness: 6, sheetsPerPane: 1 }, holes: [], notches: inlineNotches2 },
    ],
  });
  check('CREATE request with inline panes + new fields', reqRes2.status, 201);
  const reqId2 = reqRes2.data.data._id;
  const inlinePane1 = reqRes2.data.data.panes[0];
  const inlinePane2 = reqRes2.data.data.panes[1];
  check('  inline pane 1 jobType', inlinePane1.jobType, 'Laminated');
  check('  inline pane 1 rawGlass.sheetsPerPane', inlinePane1.rawGlass.sheetsPerPane, 2);
  check('  inline pane 1 holes count', inlinePane1.holes.length, 2);
  check('  inline pane 1 notches count', inlinePane1.notches.length, 1);
  check('  inline pane 1 cornerSpec', inlinePane1.cornerSpec, 'flat');
  check('  inline pane 1 dimensionTolerance', inlinePane1.dimensionTolerance, '±0.5mm');
  check('  inline pane 2 jobType', inlinePane2.jobType, 'Tempered');
  check('  inline pane 2 rawGlass.color', inlinePane2.rawGlass.color, 'เทา');
  check('  inline pane 2 holes count', inlinePane2.holes.length, 0);
  check('  inline pane 2 notches count', inlinePane2.notches.length, 3);
  check('  inline pane 2 cornerSpec default', inlinePane2.cornerSpec, '');
  check('  inline pane 2 dimensionTolerance default', inlinePane2.dimensionTolerance, '');

  // Clean up
  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/panes/${paneId2}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/requests/${reqId2}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 16c. JOB TYPE CRUD
// ──────────────────────────────────────────────

async function testJobTypeCrud(token) {
  console.log('\n=== Job Type CRUD ===\n');

  // Create
  const r1 = await api('POST', '/api/job-types', token, {
    name: 'ลามิเนต', code: 'Laminated', description: 'กระจกลามิเนต 2 แผ่นประกบ',
    sheetsPerPane: 2, defaultRawGlassTypes: ['Clear', 'Tinted'],
  });
  check('CREATE job type', r1.status, 201);
  const id1 = r1.data.data._id;
  check('  name persisted', r1.data.data.name, 'ลามิเนต');
  check('  code persisted', r1.data.data.code, 'Laminated');
  check('  sheetsPerPane', r1.data.data.sheetsPerPane, 2);
  check('  defaultRawGlassTypes length', r1.data.data.defaultRawGlassTypes.length, 2);
  check('  isActive default', r1.data.data.isActive, true);

  // Create second
  const r2 = await api('POST', '/api/job-types', token, {
    name: 'เทมเปอร์', code: 'Tempered',
  });
  check('CREATE second job type', r2.status, 201);
  const id2 = r2.data.data._id;
  check('  sheetsPerPane default', r2.data.data.sheetsPerPane, 1);
  check('  defaultRawGlassTypes default empty', r2.data.data.defaultRawGlassTypes.length, 0);

  // Duplicate code — should fail
  const r3 = await api('POST', '/api/job-types', token, { name: 'Dup', code: 'Laminated' });
  check('CREATE duplicate code', r3.status, 409);

  // GET by ID
  const r4 = await api('GET', `/api/job-types/${id1}`, token);
  check('GET job type by ID', r4.status, 200);
  check('  correct code', r4.data.data.code, 'Laminated');

  // GET all
  const r5 = await api('GET', '/api/job-types', token);
  check('GET all job types', r5.status, 200);
  check('  returns array', Array.isArray(r5.data.data), true);
  check('  has at least 2', r5.data.data.length >= 2, true);

  // GET with isActive filter
  const r5b = await api('GET', '/api/job-types?isActive=true', token);
  check('GET job types ?isActive=true', r5b.status, 200);

  // UPDATE
  const r6 = await api('PATCH', `/api/job-types/${id1}`, token, {
    description: 'Updated description', sheetsPerPane: 3, isActive: false,
  });
  check('UPDATE job type', r6.status, 200);
  check('  description updated', r6.data.data.description, 'Updated description');
  check('  sheetsPerPane updated', r6.data.data.sheetsPerPane, 3);
  check('  isActive updated', r6.data.data.isActive, false);
  check('  name preserved', r6.data.data.name, 'ลามิเนต');

  // UPDATE with duplicate code — should fail
  const r7 = await api('PATCH', `/api/job-types/${id2}`, token, { code: 'Laminated' });
  check('UPDATE duplicate code', r7.status, 409);

  // GET non-existent
  const r8 = await api('GET', '/api/job-types/000000000000000000000000', token);
  check('GET non-existent job type', r8.status, 404);

  // DELETE one
  const r9 = await api('DELETE', `/api/job-types/${id1}`, token);
  check('DELETE job type', r9.status, 200);

  const r10 = await api('GET', `/api/job-types/${id1}`, token);
  check('GET deleted job type returns 404', r10.status, 404);

  // BULK DELETE
  const r11 = await api('DELETE', '/api/job-types', token, { ids: [id2] });
  check('BULK DELETE job types', r11.status, 200);
}

// ──────────────────────────────────────────────
// 17. STICKER TEMPLATE CRUD
// ──────────────────────────────────────────────

async function testStickerTemplateCrud(token) {
  console.log('\n=== Sticker Template CRUD ===\n');

  const r1 = await api('POST', '/api/sticker-templates', token, {
    width: 100, height: 50, elements: [{ type: 'text', value: 'PNE-0001' }],
  });
  check('CREATE sticker template', r1.status, 201);
  const id1 = r1.data.data._id;
  check('  name defaults to "default"', r1.data.data.name, 'default');
  check('  width persisted', r1.data.data.width, 100);
  check('  height persisted', r1.data.data.height, 50);
  check('  elements is array', Array.isArray(r1.data.data.elements), true);
  check('  elements length', r1.data.data.elements.length, 1);

  const r2 = await api('POST', '/api/sticker-templates', token, {
    name: 'large-label', width: 200, height: 100, elements: [],
  });
  check('CREATE second sticker template', r2.status, 201);
  const id2 = r2.data.data._id;
  check('  custom name persisted', r2.data.data.name, 'large-label');

  const r3 = await api('GET', `/api/sticker-templates/${id1}`, token);
  check('GET sticker template by ID', r3.status, 200);
  check('  correct width', r3.data.data.width, 100);

  const r4 = await api('GET', '/api/sticker-templates', token);
  check('GET all sticker templates', r4.status, 200);
  check('  returns array', Array.isArray(r4.data.data), true);

  const r5 = await api('PATCH', `/api/sticker-templates/${id1}`, token, {
    width: 150, elements: [{ type: 'text', value: 'updated' }, { type: 'barcode', value: 'QR' }],
  });
  check('UPDATE sticker template', r5.status, 200);
  check('  width updated', r5.data.data.width, 150);
  check('  elements updated', r5.data.data.elements.length, 2);

  const r6 = await api('DELETE', `/api/sticker-templates/${id1}`, token);
  check('DELETE sticker template', r6.status, 200);

  const r7 = await api('GET', `/api/sticker-templates/${id1}`, token);
  check('GET deleted template returns 404', r7.status, 404);

  const r8 = await api('DELETE', '/api/sticker-templates', token, { ids: [id2] });
  check('BULK DELETE sticker templates', r8.status, 200);
}

// ──────────────────────────────────────────────
// 18. PRICING SETTINGS
// ──────────────────────────────────────────────

async function testPricingSettings(token) {
  console.log('\n=== Pricing Settings (Singleton CRUD) ===\n');

  // GET — auto-creates singleton with defaults on first access
  const r1 = await api('GET', '/api/pricing-settings', token);
  check('GET pricing-settings', r1.status, 200);
  check('  singleton is true', r1.data.data.singleton, true);
  check('  has glassPrices', typeof r1.data.data.glassPrices, 'object');
  check('  has holePriceEach', typeof r1.data.data.holePriceEach, 'number');
  check('  has notchPrice', typeof r1.data.data.notchPrice, 'number');
  check('  default holePriceEach', r1.data.data.holePriceEach, 50);
  check('  default notchPrice', r1.data.data.notchPrice, 100);

  // Check default glass prices structure
  const gp = r1.data.data.glassPrices;
  const hasGlassTypes = gp && typeof gp === 'object' && Object.keys(gp).length > 0;
  check('  glassPrices has entries', hasGlassTypes, true);

  // PUT — update holePriceEach
  const r2 = await api('PUT', '/api/pricing-settings', token, { holePriceEach: 75 });
  check('PUT pricing-settings holePriceEach', r2.status, 200);
  check('  holePriceEach updated', r2.data.data.holePriceEach, 75);
  check('  notchPrice unchanged', r2.data.data.notchPrice, 100);

  // PUT — update notchPrice
  const r3 = await api('PUT', '/api/pricing-settings', token, { notchPrice: 150 });
  check('PUT pricing-settings notchPrice', r3.status, 200);
  check('  notchPrice updated', r3.data.data.notchPrice, 150);
  check('  holePriceEach preserved', r3.data.data.holePriceEach, 75);

  // PUT — update glassPrices with grindingRate as plain number (backward-compat)
  const r4 = await api('PUT', '/api/pricing-settings', token, {
    glassPrices: { Custom: { '4mm': { pricePerSqFt: 40, grindingRate: 30 } } },
  });
  check('PUT pricing-settings glassPrices (grindingRate number)', r4.status, 200);
  check('  Custom glass type added', r4.data.data.glassPrices.Custom !== undefined, true);
  check('  Custom 4mm pricePerSqFt', r4.data.data.glassPrices.Custom['4mm'].pricePerSqFt, 40);
  check('  Custom 4mm grindingRate (number)', r4.data.data.glassPrices.Custom['4mm'].grindingRate, 30);

  // PUT — update glassPrices with grindingRate as object { rough, polished }
  const r4b = await api('PUT', '/api/pricing-settings', token, {
    glassPrices: { Custom: { '4mm': { pricePerSqFt: 40, grindingRate: { rough: 25, polished: 55 } } } },
  });
  check('PUT pricing-settings glassPrices (grindingRate object)', r4b.status, 200);
  const grRate = r4b.data.data.glassPrices.Custom['4mm'].grindingRate;
  check('  grindingRate is object', typeof grRate, 'object');
  check('  grindingRate.rough', grRate.rough, 25);
  check('  grindingRate.polished', grRate.polished, 55);

  // GET — verify grindingRate object persisted
  const r4c = await api('GET', '/api/pricing-settings', token);
  const grRatePersisted = r4c.data.data.glassPrices.Custom['4mm'].grindingRate;
  check('GET grindingRate object persisted', typeof grRatePersisted, 'object');
  check('  grindingRate.rough persisted', grRatePersisted.rough, 25);
  check('  grindingRate.polished persisted', grRatePersisted.polished, 55);

  // PUT — updatedBy is set
  check('  updatedBy is set', r4b.data.data.updatedBy !== null, true);

  // GET again — verify persistence
  const r5 = await api('GET', '/api/pricing-settings', token);
  check('GET after updates — holePriceEach', r5.data.data.holePriceEach, 75);
  check('GET after updates — notchPrice', r5.data.data.notchPrice, 150);

  // Restore defaults (including glassPrices)
  await api('PUT', '/api/pricing-settings', token, {
    holePriceEach: 50, notchPrice: 100,
    glassPrices: r1.data.data.glassPrices,
  });
}

// ──────────────────────────────────────────────
// 19. PANE LOGS
// ──────────────────────────────────────────────

async function testPaneLogs(token, stns) {
  console.log('\n=== Pane Logs (GET + Timeline) ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'PaneLog Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'PaneLog Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  // Create request with panes that have routing
  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [{ routing: [stns.cutting, stns.qc], material: matId }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1, assignedTo: workerId,
  });
  const ordId = ordRes.data.data._id;

  // Scan pane to create pane logs via the scan endpoint
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_in' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.cutting, action: 'scan_out' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'scan_in' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: stns.qc, action: 'qc_pass' });

  // GET /pane-logs — should have logs
  const r1 = await api('GET', '/api/pane-logs', token);
  check('GET /pane-logs', r1.status, 200);
  check('  returns array', Array.isArray(r1.data.data), true);
  check('  has logs', r1.data.data.length > 0, true);

  // GET /pane-logs with filters
  const r2 = await api('GET', `/api/pane-logs?station=${stns.cutting}`, token);
  check('GET /pane-logs?station=<cuttingId>', r2.status, 200);
  const cuttingLogs = r2.data.data.filter((l) => stationRefId(l.station) === String(stns.cutting));
  check('  all logs are for cutting station', cuttingLogs.length, r2.data.data.length);

  const r3 = await api('GET', '/api/pane-logs?action=scan_in', token);
  check('GET /pane-logs?action=scan_in', r3.status, 200);

  const r3b = await api('GET', '/api/pane-logs?action=qc_pass', token);
  check('GET /pane-logs?action=qc_pass', r3b.status, 200);
  check(
    '  qc_pass log for this pane',
    r3b.data.data.some((l) => String(l.pane?._id || l.pane) === String(pane._id) && l.action === 'qc_pass'),
    true,
  );

  // Create a material log for timeline
  const matLog = await api('POST', '/api/material-logs', token, {
    material: matId, actionType: 'import', quantityChanged: 50,
  });
  const matLogId = matLog.data.data._id;

  // GET /pane-logs/timeline?materialId=X
  const r4 = await api('GET', `/api/pane-logs/timeline?materialId=${matId}`, token);
  check('GET /pane-logs/timeline', r4.status, 200);
  check('  returns array', Array.isArray(r4.data.data), true);
  check('  has timeline entries', r4.data.data.length > 0, true);

  // Verify timeline has both log types
  const logTypes = [...new Set(r4.data.data.map((e) => e.logType))];
  check('  has material_log entries', logTypes.includes('material_log'), true);

  // Timeline without materialId should fail
  const r5 = await api('GET', '/api/pane-logs/timeline', token);
  check('GET /pane-logs/timeline (no materialId)', r5.status, 400);

  // Cleanup — cascade deletes handle nested children
  await api('DELETE', `/api/material-logs/${matLogId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 20. INVENTORY MOVE
// ──────────────────────────────────────────────

async function testInventoryMove(token) {
  console.log('\n=== Inventory Move ===\n');

  const mat = await api('POST', '/api/materials', token, { name: 'Move Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const inv = await api('POST', '/api/inventories', token, {
    material: matId, stockType: 'Raw', quantity: 100, location: 'WH-A', storageColor: 'blue',
  });
  const sourceId = inv.data.data._id;

  // Move 30 from WH-A to WH-B
  const r1 = await api('POST', `/api/inventories/${sourceId}/move`, token, {
    quantity: 30, toLocation: 'WH-B',
  });
  check('MOVE 30 from WH-A to WH-B', r1.status, 200);
  check('  source quantity decreased', r1.data.data.source.quantity, 70);
  check('  target quantity', r1.data.data.target.quantity, 30);
  check('  target location', r1.data.data.target.location, 'WH-B');
  check('  movedQuantity', r1.data.data.movedQuantity, 30);
  const targetId = r1.data.data.target._id;

  // Move 20 more to same location — should merge into existing target
  const r2 = await api('POST', `/api/inventories/${sourceId}/move`, token, {
    quantity: 20, toLocation: 'WH-B',
  });
  check('MOVE 20 more to WH-B (merge)', r2.status, 200);
  check('  source quantity decreased', r2.data.data.source.quantity, 50);
  check('  target quantity merged', r2.data.data.target.quantity, 50);
  check('  target _id same as before', r2.data.data.target._id, targetId);

  // Move with storageColor
  const r3 = await api('POST', `/api/inventories/${sourceId}/move`, token, {
    quantity: 10, toLocation: 'WH-C', toStorageColor: 'red',
  });
  check('MOVE with storageColor', r3.status, 200);
  check('  target storageColor', r3.data.data.target.storageColor, 'red');
  const targetId2 = r3.data.data.target._id;

  // Insufficient stock — should fail
  const r4 = await api('POST', `/api/inventories/${sourceId}/move`, token, {
    quantity: 999, toLocation: 'WH-D',
  });
  check('MOVE insufficient stock', r4.status, 400);
  checkIncludes('  message mentions insufficient', r4.data.message, 'Insufficient');

  // Verify source unchanged after failed move
  const r5 = await api('GET', `/api/inventories/${sourceId}`, token);
  check('  source unchanged after failed move', r5.data.data.quantity, 40);

  // Move from non-existent inventory
  const r6 = await api('POST', '/api/inventories/000000000000000000000000/move', token, {
    quantity: 1, toLocation: 'WH-X',
  });
  check('MOVE non-existent inventory', r6.status, 404);

  // Cleanup
  await api('DELETE', `/api/inventories/${sourceId}`, token);
  await api('DELETE', `/api/inventories/${targetId}`, token);
  await api('DELETE', `/api/inventories/${targetId2}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
}

// ──────────────────────────────────────────────
// 21. HEALTH ENDPOINT
// ──────────────────────────────────────────────

async function testHealthEndpoint() {
  console.log('\n=== Health Endpoint ===\n');

  const res = await fetch(`${API}/api/health`);
  const data = await res.json();

  check('GET /health status', res.status, 200);
  check('  success is true', data.success, true);
  check('  data.status is healthy', data.data.status, 'healthy');
  check('  has uptime', typeof data.data.uptime, 'number');
  check('  has timestamp', typeof data.data.timestamp, 'string');
  check('  uptime > 0', data.data.uptime >= 0, true);
}

// ──────────────────────────────────────────────
// ──────────────────────────────────────────────
// NEW COVERAGE TESTS
// ──────────────────────────────────────────────

async function testWorkerPasswordUpdate(token, roleIds) {
  console.log('\n=== Worker Password Update ===\n');

  const w = await api('POST', '/api/workers', token, {
    name: 'PwdTest', username: 'pwd_test', password: 'original123', position: 'tester', role: roleIds.worker,
  });
  check('CREATE worker for password test', w.status, 201);
  const wId = w.data.data._id;

  const r1 = await api('POST', '/api/auth/login', null, { username: 'pwd_test', password: 'original123' });
  check('LOGIN with original password', r1.status, 200);

  const r2 = await api('PATCH', `/api/workers/${wId}`, token, { password: 'newpass123' });
  check('UPDATE password via admin', r2.status, 200);

  const r3 = await api('POST', '/api/auth/login', null, { username: 'pwd_test', password: 'original123' });
  check('LOGIN with old password fails', r3.status, 401);

  const r4 = await api('POST', '/api/auth/login', null, { username: 'pwd_test', password: 'newpass123' });
  check('LOGIN with new password succeeds', r4.status, 200);

  await api('DELETE', `/api/workers/${wId}`, token);
}

async function testMaterialLogFilters(token) {
  console.log('\n=== MaterialLog Query Filters ===\n');

  const mat1 = await api('POST', '/api/materials', token, { name: 'Filter Mat A', unit: 'sheet', reorderPoint: 1 });
  const mat2 = await api('POST', '/api/materials', token, { name: 'Filter Mat B', unit: 'kg', reorderPoint: 1 });
  const matId1 = mat1.data.data._id;
  const matId2 = mat2.data.data._id;

  await api('POST', '/api/material-logs', token, { material: matId1, actionType: 'import', quantityChanged: 50 });
  await api('POST', '/api/material-logs', token, { material: matId1, actionType: 'cut', quantityChanged: -5 });
  await api('POST', '/api/material-logs', token, { material: matId2, actionType: 'import', quantityChanged: 30 });

  const r1 = await api('GET', `/api/material-logs?materialId=${matId1}`, token);
  check('GET material-logs ?materialId filter', r1.status, 200);
  check('  returns 2 logs for mat1', r1.data.data.length >= 2, true);
  const allMat1 = r1.data.data.every(l => String(l.material?._id || l.material) === matId1);
  check('  all logs belong to mat1', allMat1, true);

  const r2 = await api('GET', '/api/material-logs?actionType=import', token);
  check('GET material-logs ?actionType=import', r2.status, 200);
  const importOnly = r2.data.data.every(l => l.actionType === 'import');
  check('  all logs are import type', importOnly, true);

  const r3 = await api('GET', `/api/material-logs?materialId=${matId1}&actionType=cut`, token);
  check('GET material-logs ?materialId+actionType', r3.status, 200);
  check('  returns at least 1 log', r3.data.data.length >= 1, true);
  check('  first log is cut', r3.data.data[0].actionType, 'cut');

  await api('DELETE', `/api/materials/${matId1}`, token);
  await api('DELETE', `/api/materials/${matId2}`, token);
}

async function testOrderStationFilter(token, stns) {
  console.log('\n=== Order stationId Query Filter ===\n');

  const mat = await api('POST', '/api/materials', token, { name: 'StationFilter Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'StationFilter Cust' });
  const custId = cust.data.data._id;

  async function mkSf(name) {
    const r = await api('POST', '/api/stations', token, { name, templateId: stns.tmplId });
    if (r.status !== 201 || !r.data.data?._id) {
      throw new Error(`SF station "${name}" create failed (${r.status}): ${JSON.stringify(r.data)}`);
    }
    return r.data.data._id;
  }
  const sfCuttingId = await mkSf('sf_cutting');
  const sfPolishingId = await mkSf('sf_polishing');
  const sfQcId = await mkSf('sf_qc');
  const sfEdgingId = await mkSf('sf_edging');

  const ord1 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, stations: [sfCuttingId, sfPolishingId],
  });
  const ord2 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, stations: [sfCuttingId, sfQcId],
  });
  const ord3 = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, stations: [sfEdgingId],
  });
  const ordId1 = ord1.data.data._id;
  const ordId2 = ord2.data.data._id;
  const ordId3 = ord3.data.data._id;

  const r1 = await api('GET', `/api/orders?stationId=${sfCuttingId}`, token);
  check('GET orders ?stationId=<sf_cutting>', r1.status, 200);
  const cuttingIds = r1.data.data.map(o => o._id);
  check('  includes ord1', cuttingIds.includes(ordId1), true);
  check('  includes ord2', cuttingIds.includes(ordId2), true);
  check('  excludes ord3', cuttingIds.includes(ordId3), false);

  const r2 = await api('GET', `/api/orders?stationId=${sfEdgingId}`, token);
  check('GET orders ?stationId=<sf_edging>', r2.status, 200);
  const edgingIds = r2.data.data.map(o => o._id);
  check('  includes ord3', edgingIds.includes(ordId3), true);
  check('  excludes ord1', edgingIds.includes(ordId1), false);

  await api('DELETE', `/api/orders/${ordId1}`, token);
  await api('DELETE', `/api/orders/${ordId2}`, token);
  await api('DELETE', `/api/orders/${ordId3}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testPaneWithInventoryCut(token) {
  console.log('\n=== Pane Creation with Inventory (Auto-Cut MaterialLog) ===\n');

  const mat = await api('POST', '/api/materials', token, { name: 'Cut Log Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const inv = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'WH-A' });
  const invId = inv.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'Cut Log Cust' });
  const custId = cust.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1 });
  const ordId = ord.data.data._id;

  const logsBefore = await api('GET', `/api/material-logs?materialId=${matId}`, token);
  const countBefore = logsBefore.data.data.length;

  const pane = await api('POST', '/api/panes', token, { order: ordId, inventory: invId });
  check('CREATE pane with inventory', pane.status, 201);
  const paneId = pane.data.data._id;

  const logsAfter = await api('GET', `/api/material-logs?materialId=${matId}`, token);
  check('  MaterialLog count increased', logsAfter.data.data.length > countBefore, true);
  const cutLog = logsAfter.data.data.find(l => l.actionType === 'cut');
  check('  cut log exists', !!cutLog, true);
  if (cutLog) check('  cut log quantityChanged is -1', cutLog.quantityChanged, -1);

  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/inventories/${invId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testPaneGetByNumber(token) {
  console.log('\n=== Pane GET by PaneNumber ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'PaneGet Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'PaneGet Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1 });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, { order: ordId });
  check('CREATE pane', pane.status, 201);
  const paneId = pane.data.data._id;
  const paneNumber = pane.data.data.paneNumber;

  const r1 = await api('GET', `/api/panes/${paneId}`, token);
  check('GET pane by ObjectId', r1.status, 200);
  check('  correct paneNumber', r1.data.data.paneNumber, paneNumber);

  const r2 = await api('GET', `/api/panes/${paneNumber}`, token);
  check('GET pane by paneNumber', r2.status, 200);
  check('  correct _id', r2.data.data._id, paneId);

  const r3 = await api('GET', `/api/panes/${paneNumber.toLowerCase()}`, token);
  check('GET pane by lowercase paneNumber', r3.status, 200);
  check('  correct _id', r3.data.data._id, paneId);

  const r4 = await api('GET', '/api/panes/PNE-9999', token);
  check('GET non-existent paneNumber', r4.status, 404);

  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testWithdrawalMaterialLog(token) {
  console.log('\n=== Withdrawal Auto-Created MaterialLog ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'WdLog Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'WH' });

  const logsBefore = await api('GET', `/api/material-logs?materialId=${matId}`, token);
  const countBefore = logsBefore.data.data.length;

  const wd = await api('POST', '/api/withdrawals', token, {
    withdrawnBy: workerId, material: matId, quantity: 10, stockType: 'Raw',
  });
  check('CREATE withdrawal', wd.status, 201);
  const wdId = wd.data.data._id;

  const logsAfter = await api('GET', `/api/material-logs?materialId=${matId}`, token);
  check('  MaterialLog count increased', logsAfter.data.data.length > countBefore, true);
  const withdrawLog = logsAfter.data.data.find(l => l.actionType === 'withdraw');
  check('  withdraw log exists', !!withdrawLog, true);
  if (withdrawLog) {
    check('  quantityChanged is -10', withdrawLog.quantityChanged, -10);
    check('  stockType is Raw', withdrawLog.stockType, 'Raw');
  }

  await api('DELETE', `/api/withdrawals/${wdId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
}

async function testPaneDeliveredAt(token) {
  console.log('\n=== Pane deliveredAt Field ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Deliver Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Deliver Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1 });
  const ordId = ord.data.data._id;

  const pane = await api('POST', '/api/panes', token, { order: ordId });
  check('CREATE pane without deliveredAt', pane.status, 201);
  const paneId = pane.data.data._id;
  check('  deliveredAt is null', pane.data.data.deliveredAt == null, true);

  const now = new Date().toISOString();
  const r1 = await api('PATCH', `/api/panes/${paneId}`, token, { deliveredAt: now });
  check('UPDATE pane deliveredAt', r1.status, 200);
  check('  deliveredAt is set', !!r1.data.data.deliveredAt, true);

  const r2 = await api('GET', `/api/panes/${paneId}`, token);
  check('  deliveredAt persisted', !!r2.data.data.deliveredAt, true);

  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testProductionLogAdvancedFields(token, stns) {
  console.log('\n=== ProductionLog Advanced Fields ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'ProdAdv Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;
  const cust = await api('POST', '/api/customers', token, { name: 'ProdAdv Cust' });
  const custId = cust.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 1 });
  const ordId = ord.data.data._id;
  const pane = await api('POST', '/api/panes', token, { order: ordId });
  const paneId = pane.data.data._id;

  const r1 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.qc, action: 'qc_pass',
    operator: workerId,
    qcResults: [
      { label: 'Surface quality', passed: true, note: 'No scratches' },
      { label: 'Dimension check', passed: true },
      { label: 'Edge smoothness', passed: false, note: 'Minor chip' },
    ],
    status: 'pass',
    durationMs: 45000,
    startedAt: new Date(Date.now() - 45000).toISOString(),
    completedAt: new Date().toISOString(),
  });
  check('CREATE production log with qcResults', r1.status, 201);
  const logId1 = r1.data.data._id;
  check('  qcResults length', r1.data.data.qcResults.length, 3);
  check('  qcResults[0].label', r1.data.data.qcResults[0].label, 'Surface quality');
  check('  qcResults[0].passed', r1.data.data.qcResults[0].passed, true);
  check('  qcResults[2].passed', r1.data.data.qcResults[2].passed, false);
  check('  status is pass', r1.data.data.status, 'pass');
  check('  durationMs is 45000', r1.data.data.durationMs, 45000);
  check('  startedAt is set', !!r1.data.data.startedAt, true);
  check('  completedAt is set', !!r1.data.data.completedAt, true);

  const r2 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.cutting, action: 'fail',
    operator: workerId,
    defectCode: 'edge_chip',
    status: 'fail',
  });
  check('CREATE production log with defectCode', r2.status, 201);
  const logId2 = r2.data.data._id;
  check('  defectCode persisted', r2.data.data.defectCode, 'edge_chip');
  check('  status is fail', r2.data.data.status, 'fail');

  const r3 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.cutting, action: 'rework',
    operator: workerId,
    reworkReason: 'Edge chip needs re-grinding',
    status: 'rework',
  });
  check('CREATE production log with reworkReason', r3.status, 201);
  const logId3 = r3.data.data._id;
  check('  reworkReason persisted', r3.data.data.reworkReason, 'Edge chip needs re-grinding');
  check('  status is rework', r3.data.data.status, 'rework');

  const r4 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.tempering, action: 'batch_start',
    operator: workerId,
    startedAt: new Date().toISOString(),
  });
  check('CREATE production log batch_start', r4.status, 201);
  const logId4 = r4.data.data._id;
  check('  action is batch_start', r4.data.data.action, 'batch_start');

  const r5 = await api('POST', '/api/production-logs', token, {
    pane: paneId, order: ordId, station: stns.tempering, action: 'batch_complete',
    operator: workerId,
    completedAt: new Date().toISOString(),
  });
  check('CREATE production log batch_complete', r5.status, 201);
  const logId5 = r5.data.data._id;
  check('  action is batch_complete', r5.data.data.action, 'batch_complete');

  const r6 = await api('GET', `/api/production-logs/${logId1}`, token);
  check('GET production log includes qcResults', r6.data.data.qcResults.length, 3);
  check('  includes durationMs', r6.data.data.durationMs, 45000);

  const r7 = await api('PATCH', `/api/production-logs/${logId2}`, token, {
    defectCode: null, status: null,
  });
  check('UPDATE production log clear defectCode', r7.status, 200);

  await api('DELETE', `/api/production-logs/${logId1}`, token);
  await api('DELETE', `/api/production-logs/${logId2}`, token);
  await api('DELETE', `/api/production-logs/${logId3}`, token);
  await api('DELETE', `/api/production-logs/${logId4}`, token);
  await api('DELETE', `/api/production-logs/${logId5}`, token);
  await api('DELETE', `/api/panes/${paneId}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testNotificationReferences(token) {
  console.log('\n=== Notification referenceId/referenceType ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const r1 = await api('POST', '/api/notifications', token, {
    recipient: workerId,
    type: 'pane_arrived',
    title: 'Test notification',
    message: 'A pane has arrived',
    referenceId: workerId,
    referenceType: 'Pane',
    priority: 'high',
  });
  check('CREATE notification with referenceId', r1.status, 201);
  const notifId = r1.data.data._id;
  check('  referenceId persisted', r1.data.data.referenceId, workerId);
  check('  referenceType persisted', r1.data.data.referenceType, 'Pane');
  check('  priority persisted', r1.data.data.priority, 'high');

  const r2 = await api('GET', `/api/notifications/${notifId}`, token);
  check('GET notification includes referenceId', r2.data.data.referenceId, workerId);
  check('  includes referenceType', r2.data.data.referenceType, 'Pane');

  const r3 = await api('POST', '/api/notifications', token, {
    recipient: workerId,
    type: 'info',
    title: 'Simple notification',
  });
  check('CREATE notification without referenceId', r3.status, 201);
  const notifId2 = r3.data.data._id;
  check('  referenceId defaults to null', r3.data.data.referenceId, null);
  check('  referenceType defaults to null', r3.data.data.referenceType, null);

  await api('DELETE', `/api/notifications/${notifId}`, token);
  await api('DELETE', `/api/notifications/${notifId2}`, token);
}

// ──────────────────────────────────────────────
// LAMINATE PAIRING
// ──────────────────────────────────────────────

async function testLaminatePairing(token, stns) {
  console.log('\n=== Laminate Pairing — Auto-Create Sheets ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'Laminate Cust' });
  const custId = cust.data.data._id;

  const tmpl = await api('POST', '/api/station-templates', token, { name: 'Laminate Tmpl' });
  const tmplId = tmpl.data.data._id;

  const cutting = (await api('POST', '/api/stations', token, { name: 'lam_cutting', templateId: tmplId })).data.data._id;
  const edging = (await api('POST', '/api/stations', token, { name: 'lam_edging', templateId: tmplId })).data.data._id;
  const lamStation = (await api('POST', '/api/stations', token, { name: 'lam_laminate', templateId: tmplId, isLaminateStation: true })).data.data._id;
  const qcStation = (await api('POST', '/api/stations', token, { name: 'lam_qc', templateId: tmplId })).data.data._id;

  const routing = [cutting, edging, lamStation, qcStation];

  // Reject if sheetsPerPane > 1 but no laminate station in routing
  const noLamRouting = [cutting, edging, qcStation];
  const rejectRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 1 },
    panes: [{ routing: noLamRouting, rawGlass: { sheetsPerPane: 2 }, dimensions: { width: 800, height: 600, thickness: 5 } }],
  });
  check('REJECT request without laminate station', rejectRes.status, 400);

  // Create request with laminate pane
  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 1 },
    panes: [
      {
        routing,
        dimensions: { width: 800, height: 600, thickness: 5 },
        rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 2 },
        jobType: 'Laminated',
        cornerSpec: 'chamfer 3mm',
        dimensionTolerance: '±1mm',
        holes: [{ id: 'lh1', type: 'circle', x: 100, y: 200, diameter: 10 }],
      },
    ],
  });
  check('CREATE request with sheetsPerPane: 2', reqRes.status, 201);
  const reqId = reqRes.data.data._id;
  const allPanes = reqRes.data.data.panes;

  const sheets = allPanes.filter(p => p.laminateRole === 'sheet');
  const parents = allPanes.filter(p => p.laminateRole === 'parent');

  check('2 sheet panes created', sheets.length, 2);
  check('1 parent pane created', parents.length, 1);

  const parent = parents[0];
  const sheetA = sheets.find(s => s.sheetLabel === 'A');
  const sheetB = sheets.find(s => s.sheetLabel === 'B');

  check('parent has childPanes array', parent.childPanes.length, 2);
  check('parent laminateRole', parent.laminateRole, 'parent');
  check('parent currentStation is null', parent.currentStation, null);
  check('parent currentStatus is pending', parent.currentStatus, 'pending');
  check('parent routing is post-laminate only', parent.routing.length, 1);

  check('sheet A exists', !!sheetA, true);
  check('sheet B exists', !!sheetB, true);
  check('sheet A laminateRole', sheetA.laminateRole, 'sheet');
  check('sheet A parentPane set', String(sheetA.parentPane), String(parent._id));
  check('sheet A routing is pre-laminate + laminate', sheetA.routing.length, 3);
  check('sheet A paneNumber has suffix', sheetA.paneNumber.endsWith('-A'), true);
  check('sheet B paneNumber has suffix', sheetB.paneNumber.endsWith('-B'), true);
  check('sheet A cornerSpec cloned', sheetA.cornerSpec, 'chamfer 3mm');
  check('sheet A holes cloned', sheetA.holes.length, 1);
  check('sheet A dimensions.width', sheetA.dimensions.width, 800);

  // Query filters
  const parentFilter = await api('GET', `/api/panes?laminateRole=parent&request=${reqId}`, token);
  check('laminateRole=parent filter', parentFilter.data.data.length, 1);

  const sheetFilter = await api('GET', `/api/panes?laminateRole=sheet&parentPane=${parent._id}`, token);
  check('parentPane filter returns sheets', sheetFilter.data.data.length, 2);

  // Non-laminate pane should default to 'single'
  const singleReqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [{ routing: [cutting], dimensions: { width: 500, height: 400, thickness: 4 } }],
  });
  const singlePane = singleReqRes.data.data.panes[0];
  check('non-laminate pane is single', singlePane.laminateRole, 'single');

  // Cleanup
  for (const p of allPanes) await api('DELETE', `/api/panes/${p._id}`, token);
  await api('DELETE', `/api/panes/${singlePane._id}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/requests/${singleReqRes.data.data._id}`, token);
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

async function testLaminateScanFlow(token) {
  console.log('\n=== Laminate Scan Flow — Merge at Station ===\n');

  const cust = await api('POST', '/api/customers', token, { name: 'LamScan Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'LamScan Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const tmpl = await api('POST', '/api/station-templates', token, { name: 'LamScan Tmpl' });
  const tmplId = tmpl.data.data._id;

  const cutting = (await api('POST', '/api/stations', token, { name: 'ls_cutting', templateId: tmplId })).data.data._id;
  const lamStation = (await api('POST', '/api/stations', token, { name: 'ls_laminate', templateId: tmplId, isLaminateStation: true })).data.data._id;
  const qcStation = (await api('POST', '/api/stations', token, { name: 'ls_qc', templateId: tmplId })).data.data._id;

  const routing = [cutting, lamStation, qcStation];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'laminated', quantity: 1 },
    panes: [{
      routing,
      dimensions: { width: 800, height: 600, thickness: 5 },
      rawGlass: { glassType: 'Clear', sheetsPerPane: 2 },
    }],
  });
  check('CREATE laminate request', reqRes.status, 201);
  const reqId = reqRes.data.data._id;
  const allPanes = reqRes.data.data.panes;

  const parent = allPanes.find(p => p.laminateRole === 'parent');
  const sheetA = allPanes.find(p => p.sheetLabel === 'A');
  const sheetB = allPanes.find(p => p.sheetLabel === 'B');

  // Create order and link panes
  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1,
  });
  const ordId = ordRes.data.data._id;

  // Panes are auto-linked to order via backfill when order is created with request
  // Verify paneCount is correct (only parent counts, not sheets)
  const ordAfterLink = await api('GET', `/api/orders/${ordId}`, token);
  check('paneCount is 1 (only parent counts)', ordAfterLink.data.data.paneCount, 1);

  // Scan sheet A through cutting
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: cutting, action: 'scan_in' });
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: cutting, action: 'complete' });
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: cutting, action: 'scan_out' });

  // Scan sheet B through cutting
  await api('POST', `/api/panes/${sheetB.paneNumber}/scan`, token, { station: cutting, action: 'scan_in' });
  await api('POST', `/api/panes/${sheetB.paneNumber}/scan`, token, { station: cutting, action: 'complete' });
  await api('POST', `/api/panes/${sheetB.paneNumber}/scan`, token, { station: cutting, action: 'scan_out' });

  // Both sheets should now be at laminate station
  const sheetAAtLam = await api('GET', `/api/panes/${sheetA._id}`, token);
  check('sheet A at laminate station', sheetAAtLam.data.data.currentStation?._id || sheetAAtLam.data.data.currentStation, lamStation);

  // Scan sheet A into laminate station
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: lamStation, action: 'scan_in' });

  // Try laminate before all sheets present — should fail (only A scanned in at lam)
  const earlyLam = await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: lamStation, action: 'laminate' });
  check('laminate fails before all sheets present', earlyLam.status, 400);

  // Parent path without survivor number should fail
  const parentNoSurvivor = await api('POST', `/api/panes/${parent.paneNumber}/scan`, token, { station: lamStation, action: 'laminate' });
  check('laminate via parent requires laminateSurvivorPaneNumber', parentNoSurvivor.status, 400);

  // Scan sheet B into laminate station
  await api('POST', `/api/panes/${sheetB.paneNumber}/scan`, token, { station: lamStation, action: 'scan_in' });

  const badSurvivor = await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, {
    station: lamStation, action: 'laminate', laminateSurvivorPaneNumber: 'PNE-NOT-A-SHEET-999',
  });
  check('laminate invalid laminateSurvivorPaneNumber → 400', badSurvivor.status, 400);

  const survParentNum = await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, {
    station: lamStation, action: 'laminate', laminateSurvivorPaneNumber: parent.paneNumber,
  });
  check('laminate survivor cannot be parent pane number', survParentNum.status, 400);

  const parentPathOk = await api('POST', `/api/panes/${parent.paneNumber}/scan`, token, {
    station: lamStation, action: 'laminate', laminateSurvivorPaneNumber: sheetA.paneNumber,
  });
  check('laminate via parent path + laminateSurvivorPaneNumber → 200', parentPathOk.status, 200);
  check('mergedSheets count', parentPathOk.data.data.mergedSheets, 2);
  check('response survivorPaneNumber is sheet A', parentPathOk.data.data.survivorPaneNumber, sheetA.paneNumber);

  const sheetAAfter = await api('GET', `/api/panes/${sheetA._id}`, token);
  check('sheet A survivor: awaiting_scan_out at lam', sheetAAfter.data.data.currentStatus, 'awaiting_scan_out');
  check('sheet A laminateRole single', sheetAAfter.data.data.laminateRole, 'single');
  check('sheet A at laminate station', sheetAAfter.data.data.currentStation?._id || sheetAAfter.data.data.currentStation, lamStation);

  const sheetBAfter = await api('GET', `/api/panes/${sheetB._id}`, token);
  check('sheet B merged_into', sheetBAfter.data.data.currentStatus, 'merged_into');
  check('sheet B points to survivor', docRefId(sheetBAfter.data.data.mergedInto), String(sheetA._id));

  const parentAfter = await api('GET', `/api/panes/${parent._id}`, token);
  check('parent merged_into', parentAfter.data.data.currentStatus, 'merged_into');
  check('parent points to survivor', docRefId(parentAfter.data.data.mergedInto), String(sheetA._id));

  const listDefault = await api('GET', `/api/panes?order=${ordId}&limit=100`, token);
  check('default pane list hides merged_into (1 row)', listDefault.data.data.length, 1);

  const listInc = await api('GET', `/api/panes?order=${ordId}&includeMerged=true&limit=100`, token);
  check('includeMerged=true returns all 3 rows', listInc.data.data.length, 3);

  const mergedScan = await api('POST', `/api/panes/${sheetB.paneNumber}/scan`, token, { station: lamStation, action: 'scan_in' });
  check('scan merged_into returns 400', mergedScan.status, 400);
  check('MERGED_INTO code', mergedScan.data.errors?.code, 'MERGED_INTO');

  const lamScanOut = await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: lamStation, action: 'scan_out' });
  check('survivor scan_out from laminate succeeds', lamScanOut.status, 200);
  check('survivor advanced to qc', lamScanOut.data.data.pane.currentStation?._id, qcStation);
  check('survivor status pending at qc', lamScanOut.data.data.pane.currentStatus, 'pending');

  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: qcStation, action: 'scan_in' });
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: qcStation, action: 'complete' });
  await api('POST', `/api/panes/${sheetA.paneNumber}/scan`, token, { station: qcStation, action: 'scan_out' });

  const survivorFinal = await api('GET', `/api/panes/${sheetA._id}`, token);
  check('survivor completed after QC', survivorFinal.data.data.currentStatus, 'completed');

  const paneLogs = await api('GET', '/api/pane-logs', token);
  const lamCompleteLogs = paneLogs.data.data.filter(l => l.action === 'laminate_complete');
  const lamStartLogs = paneLogs.data.data.filter(l => l.action === 'laminate_start');
  check('laminate_complete logs (2 sheets + parent)', lamCompleteLogs.length >= 3, true);
  check('laminate_start log exists', lamStartLogs.length >= 1, true);

  // Cleanup
  for (const p of allPanes) await api('DELETE', `/api/panes/${p._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/station-templates/${tmplId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('=== Data Integrity Test Suite ===');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}`);

  const snapshot = await snapshotIds(API, token);

  const roleIds = await getRoleIds(token);

  const stns = await createStations(token);

  try {
    await testCascadeDeletes(token, roleIds);
    await testReferentialChecks(token);
    await testInventoryDeduction(token);
    await testMaterialLogCascade(token);
    await testRequestCascade(token);
    await testStationTemplateCascade(token);
    await testStationColorId(token);
    await testNotificationPreferences(token, roleIds);
    await testOrderNewFields(token, stns);
    await testWithdrawalNotes(token);
    await testRequestNumbering(token);
    await testOrderNumbering(token);
    await testClaimNumbering(token);
    await testClaimFromPane(token);
    await testPaneNumbering(token, stns);
    await testPaneCascade(token, stns);
    await testPaneReferentialChecks(token, stns);
    await testRequestWithPanes(token);
    await testPaneNewFields(token);
    await testJobTypeCrud(token);
    await testStickerTemplateCrud(token);
    await testPricingSettings(token);
    await testPaneLogs(token, stns);
    await testInventoryMove(token);
    await testHealthEndpoint();
    await testWorkerPasswordUpdate(token, roleIds);
    await testMaterialLogFilters(token);
    await testOrderStationFilter(token, stns);
    await testPaneWithInventoryCut(token);
    await testPaneGetByNumber(token);
    await testWithdrawalMaterialLog(token);
    await testPaneDeliveredAt(token);
    await testProductionLogAdvancedFields(token, stns);
    await testNotificationReferences(token);
    await testLaminatePairing(token, stns);
    await testLaminateScanFlow(token);
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
