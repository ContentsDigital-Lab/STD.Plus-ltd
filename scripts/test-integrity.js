require('dotenv').config();
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

// ──────────────────────────────────────────────
// 1. CASCADE DELETE PROTECTION
// ──────────────────────────────────────────────

async function testCascadeDeletes(token) {
  console.log('\n=== Cascade Delete Protection ===\n');

  // Create a material
  const mat = await api('POST', '/api/materials', token, { name: 'Cascade Glass', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  // Create a customer
  const cust = await api('POST', '/api/customers', token, { name: 'Cascade Customer' });
  const custId = cust.data.data._id;

  // Create an inventory referencing the material
  const inv = await api('POST', '/api/inventories', token, { material: matId, stockType: 'Raw', quantity: 100, location: 'Warehouse A' });
  const invId = inv.data.data._id;

  // Try to delete material — should be blocked (referenced by inventory)
  const r1 = await api('DELETE', `/api/materials/${matId}`, token);
  check('DELETE material with inventory ref', r1.status, 409);
  checkIncludes('  message mentions inventory', r1.data.message, 'inventory record(s)');

  // Delete the inventory first, then material should succeed
  await api('DELETE', `/api/inventories/${invId}`, token);
  const r2 = await api('DELETE', `/api/materials/${matId}`, token);
  check('DELETE material after inventory removed', r2.status, 200);

  // Create fresh material + order to test customer cascade
  const mat2 = await api('POST', '/api/materials', token, { name: 'Cascade Glass 2', unit: 'sheet', reorderPoint: 5 });
  const matId2 = mat2.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId2, quantity: 5 });
  const ordId = ord.data.data._id;

  // Try to delete customer — should be blocked (referenced by order)
  const r3 = await api('DELETE', `/api/customers/${custId}`, token);
  check('DELETE customer with order ref', r3.status, 409);
  checkIncludes('  message mentions order', r3.data.message, 'order(s)');

  // Try to delete material — should be blocked (referenced by order)
  const r4 = await api('DELETE', `/api/materials/${matId2}`, token);
  check('DELETE material with order ref', r4.status, 409);

  // Try to delete order — should succeed (no children yet)
  const r5 = await api('DELETE', `/api/orders/${ordId}`, token);
  check('DELETE order with no children', r5.status, 200);

  // Now create order + claim, test order cascade
  const ord2 = await api('POST', '/api/orders', token, { customer: custId, material: matId2, quantity: 3 });
  const ordId2 = ord2.data.data._id;

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const claim = await api('POST', `/api/orders/${ordId2}/claims`, token, {
    source: 'worker', material: matId2, description: 'Test claim', reportedBy: workerId,
  });
  const claimId = claim.data.data._id;

  // Try to delete order — should be blocked (has claim)
  const r6 = await api('DELETE', `/api/orders/${ordId2}`, token);
  check('DELETE order with claim ref', r6.status, 409);
  checkIncludes('  message mentions claim', r6.data.message, 'claim(s)');

  // Delete claim, then order, then material, then customer
  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/orders/${ordId2}`, token);
  await api('DELETE', `/api/materials/${matId2}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);

  // Test bulk delete protection
  const mat3 = await api('POST', '/api/materials', token, { name: 'Bulk Mat A', unit: 'kg', reorderPoint: 1 });
  const mat4 = await api('POST', '/api/materials', token, { name: 'Bulk Mat B', unit: 'kg', reorderPoint: 1 });
  const matId3 = mat3.data.data._id;
  const matId4 = mat4.data.data._id;

  const inv2 = await api('POST', '/api/inventories', token, { material: matId3, stockType: 'Raw', quantity: 10, location: 'WH' });
  const invId2 = inv2.data.data._id;

  // Bulk delete both materials — should be blocked (matId3 has inventory)
  const r7 = await api('DELETE', '/api/materials', token, { ids: [matId3, matId4] });
  check('DELETE MANY materials with ref', r7.status, 409);

  // Clean up and retry
  await api('DELETE', `/api/inventories/${invId2}`, token);
  const r8 = await api('DELETE', '/api/materials', token, { ids: [matId3, matId4] });
  check('DELETE MANY materials after cleanup', r8.status, 200);

  // Worker cascade: create worker, assign to order, try delete
  const w = await api('POST', '/api/workers', token, { name: 'Temp Worker', username: 'temp_cascade', password: 'temp123456', position: 'temp' });
  const wId = w.data.data._id;
  const mat5 = await api('POST', '/api/materials', token, { name: 'Worker Mat', unit: 'pc', reorderPoint: 1 });
  const matId5 = mat5.data.data._id;
  const cust2 = await api('POST', '/api/customers', token, { name: 'Worker Cust' });
  const custId2 = cust2.data.data._id;
  const ord3 = await api('POST', '/api/orders', token, { customer: custId2, material: matId5, quantity: 1, assignedTo: wId });
  const ordId3 = ord3.data.data._id;

  const r9 = await api('DELETE', `/api/workers/${wId}`, token);
  check('DELETE worker with order assignment', r9.status, 409);
  checkIncludes('  message mentions order', r9.data.message, 'order(s)');

  // Clean up
  await api('DELETE', `/api/orders/${ordId3}`, token);
  const r10 = await api('DELETE', `/api/workers/${wId}`, token);
  check('DELETE worker after order removed', r10.status, 200);
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

  // Clean up
  await api('DELETE', `/api/stations/${stationId}`, token);
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

  // Try delete parent — should be blocked
  const r1 = await api('DELETE', `/api/material-logs/${parentId}`, token);
  check('DELETE parent log with child ref', r1.status, 409);
  checkIncludes('  message mentions child', r1.data.message, 'child log(s)');

  // Delete child first, then parent
  await api('DELETE', `/api/material-logs/${childId}`, token);
  const r2 = await api('DELETE', `/api/material-logs/${parentId}`, token);
  check('DELETE parent log after child removed', r2.status, 200);

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

  // Create order referencing this request
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: matId, quantity: 5, request: reqId });
  const ordId = ord.data.data._id;

  // Try delete request — should be blocked
  const r1 = await api('DELETE', `/api/requests/${reqId}`, token);
  check('DELETE request with order ref', r1.status, 409);
  checkIncludes('  message mentions order', r1.data.message, 'order(s)');

  // Delete order first, then request
  await api('DELETE', `/api/orders/${ordId}`, token);
  const r2 = await api('DELETE', `/api/requests/${reqId}`, token);
  check('DELETE request after order removed', r2.status, 200);

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

  // Try delete template — should be blocked (referenced by station)
  const r1 = await api('DELETE', `/api/station-templates/${tmplId}`, token);
  check('DELETE template with station ref', r1.status, 409);
  checkIncludes('  message mentions station', r1.data.message, 'station(s)');

  // Delete station first, then template should succeed
  await api('DELETE', `/api/stations/${stationId}`, token);
  const r2 = await api('DELETE', `/api/station-templates/${tmplId}`, token);
  check('DELETE template after station removed', r2.status, 200);

  // Bulk delete protection
  const tmpl2 = await api('POST', '/api/station-templates', token, { name: 'Bulk A' });
  const tmpl3 = await api('POST', '/api/station-templates', token, { name: 'Bulk B' });
  const tmplId2 = tmpl2.data.data._id;
  const tmplId3 = tmpl3.data.data._id;

  const station2 = await api('POST', '/api/stations', token, { name: 'Ref Station', templateId: tmplId2 });
  const stationId2 = station2.data.data._id;

  // Bulk delete both templates — should be blocked (tmplId2 has station)
  const r3 = await api('DELETE', '/api/station-templates', token, { ids: [tmplId2, tmplId3] });
  check('DELETE MANY templates with ref', r3.status, 409);

  // Clean up and retry
  await api('DELETE', `/api/stations/${stationId2}`, token);
  const r4 = await api('DELETE', '/api/station-templates', token, { ids: [tmplId2, tmplId3] });
  check('DELETE MANY templates after cleanup', r4.status, 200);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('=== Data Integrity Test Suite ===');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}`);

  await testCascadeDeletes(token);
  await testReferentialChecks(token);
  await testInventoryDeduction(token);
  await testMaterialLogCascade(token);
  await testRequestCascade(token);
  await testStationTemplateCascade(token);

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
