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
    console.log(`   FAIL  ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

function checkTruthy(label, value) {
  if (value) {
    console.log(`   PASS  ${label} — ${value}`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — expected truthy, got ${JSON.stringify(value)}`);
    failed++;
  }
}

// ──────────────────────────────────────────────
// 1. CLAIM CREATION PULLS PANE FROM STATION
// ──────────────────────────────────────────────

async function testClaimPullsPaneFromStation(token) {
  console.log('\n=== Claim Creation — Pane Pulled from Station ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Pull Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Pull Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = ['cutting', 'edging', 'qc'];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 2 },
    panes: [
      { routing, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered', jobType: 'Tempered', rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 1 } },
      { routing, dimensions: { width: 1000, height: 500, thickness: 6 }, glassType: 'laminated', jobType: 'Laminated', rawGlass: { glassType: 'Clear', color: 'เขียว', thickness: 6, sheetsPerPane: 2 } },
    ],
  });
  const reqId = reqRes.data.data._id;
  const pane1 = reqRes.data.data.panes[0];
  const pane2 = reqRes.data.data.panes[1];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 2, request: reqId, paneCount: 2,
    assignedTo: workerId, stations: routing,
  });
  const ordId = ordRes.data.data._id;

  // Move pane1 to edging first
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane1.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });

  const pane1AtEdging = await api('GET', `/api/panes/${pane1._id}`, token);
  check('pane1 is at edging before claim', pane1AtEdging.data.data.currentStation, 'edging');

  // Create claim via POST /api/claims/from-pane
  const claimRes = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: pane1.paneNumber,
    source: 'worker',
    description: 'Scratch found on pane 1',
    defectCode: 'scratch',
    defectStation: 'edging',
    reportedBy: workerId,
  });
  check('CREATE claim from pane', claimRes.status, 201);
  const claimId = claimRes.data.data._id;

  // Verify pane is pulled from station
  const pane1After = await api('GET', `/api/panes/${pane1._id}`, token);
  check('pane1 currentStation is "claimed"', pane1After.data.data.currentStation, 'claimed');
  check('pane1 currentStatus is "completed"', pane1After.data.data.currentStatus, 'completed');

  // Verify order station breakdown updated
  const ordAfter = await api('GET', `/api/orders/${ordId}`, token);
  const breakdown = ordAfter.data.data.stationBreakdown || {};
  check('order breakdown edging decremented', (breakdown.edging || 0) === 0, true);

  // Test claim via POST /api/orders/:orderId/claims (pane2 at cutting)
  const claimRes2 = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'worker',
    material: matId,
    description: 'Chip on pane 2',
    defectCode: 'chipped',
    pane: pane2._id,
    reportedBy: workerId,
  });
  check('CREATE claim via order endpoint', claimRes2.status, 201);
  const claimId2 = claimRes2.data.data._id;

  const pane2After = await api('GET', `/api/panes/${pane2._id}`, token);
  check('pane2 currentStation is "claimed"', pane2After.data.data.currentStation, 'claimed');
  check('pane2 currentStatus is "completed"', pane2After.data.data.currentStatus, 'completed');

  // Cleanup
  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/claims/${claimId2}`, token);

  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) =>
    [pane1._id, pane2._id].includes(l.pane?._id || l.pane)
  );
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const claimNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' || n.type === 'claim_approved'
  );
  if (claimNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: claimNotifs.map((n) => n._id) });
  }

  await api('DELETE', `/api/panes/${pane1._id}`, token);
  await api('DELETE', `/api/panes/${pane2._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 2. CLAIM APPROVAL — REMAKE PANE CREATED
// ──────────────────────────────────────────────

async function testClaimApprovalCreateRemake(token) {
  console.log('\n=== Claim Approval — Remake Pane Created ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Approve Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Approve Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = ['cutting', 'edging', 'qc'];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'tempered', quantity: 1 },
    panes: [
      {
        routing,
        dimensions: { width: 800, height: 600, thickness: 5 },
        glassType: 'tempered',
        glassTypeLabel: 'กระจกนิรภัย',
        jobType: 'Tempered',
        rawGlass: { glassType: 'Clear', color: 'ใส', thickness: 5, sheetsPerPane: 1 },
        processes: ['cutting', 'tempering'],
      },
    ],
  });
  const reqId = reqRes.data.data._id;
  const originalPane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1,
    assignedTo: workerId, stations: routing,
  });
  const ordId = ordRes.data.data._id;

  // Move pane to edging
  await api('POST', `/api/panes/${originalPane.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${originalPane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });

  // Create claim (pane pulled from station)
  const claimRes = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: originalPane.paneNumber,
    source: 'worker',
    description: 'Wrong dimension',
    defectCode: 'dimension_wrong',
    defectStation: 'edging',
    reportedBy: workerId,
  });
  check('CREATE claim', claimRes.status, 201);
  const claimId = claimRes.data.data._id;
  check('claim status is pending', claimRes.data.data.status, 'pending');
  check('claim remadePane is null', claimRes.data.data.remadePane, null);

  // Approve claim with decision: destroy
  const approveRes = await api('PATCH', `/api/claims/${claimId}`, token, {
    status: 'approved',
    decision: 'destroy',
    approvedBy: workerId,
  });
  check('APPROVE claim (destroy)', approveRes.status, 200);
  check('claim status is approved', approveRes.data.data.status, 'approved');
  check('claim decision is destroy', approveRes.data.data.decision, 'destroy');
  checkTruthy('claim remadePane is populated', approveRes.data.data.remadePane);

  const remadePaneId = approveRes.data.data.remadePane._id || approveRes.data.data.remadePane;

  // Verify the remake pane
  const remadeRes = await api('GET', `/api/panes/${remadePaneId}`, token);
  const remade = remadeRes.data.data;

  check('remade pane has new paneNumber', remade.paneNumber !== originalPane.paneNumber, true);
  check('remade pane order is null (no order yet)', remade.order, null);
  check('remade pane same request', String(remade.request?._id || remade.request), String(reqId));
  check('remade pane currentStation is order_release', remade.currentStation, 'order_release');
  check('remade pane currentStatus is pending', remade.currentStatus, 'pending');
  check('remade pane remakeOf points to original', String(remade.remakeOf?._id || remade.remakeOf), String(originalPane._id));

  // Verify specs cloned
  check('remade pane width', remade.dimensions?.width, 800);
  check('remade pane height', remade.dimensions?.height, 600);
  check('remade pane thickness', remade.dimensions?.thickness, 5);
  check('remade pane jobType', remade.jobType, 'Tempered');
  check('remade pane glassType', remade.glassType, 'tempered');
  check('remade pane rawGlass.glassType', remade.rawGlass?.glassType, 'Clear');
  check('remade pane rawGlass.color', remade.rawGlass?.color, 'ใส');
  check('remade pane rawGlass.thickness', remade.rawGlass?.thickness, 5);
  check('remade pane rawGlass.sheetsPerPane', remade.rawGlass?.sheetsPerPane, 1);
  check('remade pane routing matches', JSON.stringify(remade.routing), JSON.stringify(routing));

  // Verify original order is unchanged
  const ordAfter = await api('GET', `/api/orders/${ordId}`, token);
  check('original order paneCount unchanged', ordAfter.data.data.paneCount, 1);

  // Verify MaterialLog was created
  const matLogs = await api('GET', '/api/material-logs?limit=100', token);
  const remakeLogs = matLogs.data.data.filter((l) =>
    l.actionType === 'remake' && String(l.pane?._id || l.pane) === String(remadePaneId)
  );
  check('MaterialLog remake entry exists', remakeLogs.length >= 1, true);

  // Cleanup
  if (remakeLogs.length > 0) {
    await api('DELETE', '/api/material-logs', token, { ids: remakeLogs.map((l) => l._id) });
  }

  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) =>
    String(l.pane?._id || l.pane) === String(originalPane._id)
  );
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const testNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' || n.type === 'claim_approved'
  );
  if (testNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: testNotifs.map((n) => n._id) });
  }

  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/panes/${remadePaneId}`, token);
  await api('DELETE', `/api/panes/${originalPane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 3. DECISION KEEP ALSO CREATES REMAKE
// ──────────────────────────────────────────────

async function testKeepDecisionAlsoCreatesRemake(token) {
  console.log('\n=== Decision "keep" Also Creates Remake ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Keep Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Keep Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const routing = ['cutting', 'qc'];

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing, dimensions: { width: 500, height: 400, thickness: 4 }, glassType: 'clear', jobType: 'Clear' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1,
    assignedTo: workerId, stations: routing,
  });
  const ordId = ordRes.data.data._id;

  // Create claim
  const claimRes = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: pane.paneNumber,
    source: 'customer',
    description: 'Minor scratch, keep original',
    defectCode: 'scratch',
    reportedBy: workerId,
  });
  const claimId = claimRes.data.data._id;

  // Approve with decision: keep
  const approveRes = await api('PATCH', `/api/claims/${claimId}`, token, {
    status: 'approved',
    decision: 'keep',
    approvedBy: workerId,
  });
  check('APPROVE claim (keep)', approveRes.status, 200);
  check('claim decision is keep', approveRes.data.data.decision, 'keep');
  checkTruthy('remadePane created even with keep', approveRes.data.data.remadePane);

  const remadePaneId = approveRes.data.data.remadePane._id || approveRes.data.data.remadePane;
  const remadeRes = await api('GET', `/api/panes/${remadePaneId}`, token);
  check('remake pane at order_release', remadeRes.data.data.currentStation, 'order_release');
  check('remake pane order is null', remadeRes.data.data.order, null);
  check('remake pane width matches', remadeRes.data.data.dimensions?.width, 500);
  check('remake pane height matches', remadeRes.data.data.dimensions?.height, 400);

  // Cleanup
  const matLogs = await api('GET', '/api/material-logs?limit=100', token);
  const remakeLogs = matLogs.data.data.filter((l) => l.actionType === 'remake');
  if (remakeLogs.length > 0) {
    await api('DELETE', '/api/material-logs', token, { ids: remakeLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const testNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' || n.type === 'claim_approved'
  );
  if (testNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: testNotifs.map((n) => n._id) });
  }

  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/panes/${remadePaneId}`, token);
  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 4. NO DUPLICATE REMAKE ON RE-APPROVAL
// ──────────────────────────────────────────────

async function testNoDuplicateRemake(token) {
  console.log('\n=== No Duplicate Remake on Re-Approval ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Dup Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Dup Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: ['cutting'], dimensions: { width: 300, height: 200, thickness: 3 }, glassType: 'clear' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1, stations: ['cutting'],
  });
  const ordId = ordRes.data.data._id;

  // Create and approve claim
  const claimRes = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: pane.paneNumber,
    source: 'worker',
    description: 'Broken glass',
    defectCode: 'broken',
    reportedBy: workerId,
  });
  const claimId = claimRes.data.data._id;

  const approveRes = await api('PATCH', `/api/claims/${claimId}`, token, {
    status: 'approved',
    decision: 'destroy',
    approvedBy: workerId,
  });
  const remadePaneId = approveRes.data.data.remadePane._id || approveRes.data.data.remadePane;
  checkTruthy('first approval creates remake', remadePaneId);

  // Update again with status: approved (already approved)
  const reApproveRes = await api('PATCH', `/api/claims/${claimId}`, token, {
    status: 'approved',
    description: 'Updated description',
  });
  check('re-approval returns 200', reApproveRes.status, 200);

  // remadePane should still be the same one (no new pane created)
  const sameRemade = reApproveRes.data.data.remadePane._id || reApproveRes.data.data.remadePane;
  check('remadePane unchanged after re-approval', String(sameRemade), String(remadePaneId));

  // Count remake panes — should be exactly 1
  const allPanes = await api('GET', '/api/panes?limit=100', token);
  const remakePanes = allPanes.data.data.filter((p) =>
    String(p.remakeOf?._id || p.remakeOf) === String(pane._id)
  );
  check('only 1 remake pane created (no duplicates)', remakePanes.length, 1);

  // Cleanup
  const matLogs = await api('GET', '/api/material-logs?limit=100', token);
  const remakeLogs = matLogs.data.data.filter((l) => l.actionType === 'remake');
  if (remakeLogs.length > 0) {
    await api('DELETE', '/api/material-logs', token, { ids: remakeLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const testNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' || n.type === 'claim_approved'
  );
  if (testNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: testNotifs.map((n) => n._id) });
  }

  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/panes/${remadePaneId}`, token);
  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 5. REJECTION DOES NOT CREATE REMAKE
// ──────────────────────────────────────────────

async function testRejectionNoRemake(token) {
  console.log('\n=== Rejection Does Not Create Remake ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Reject Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Reject Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: ['cutting'], dimensions: { width: 300, height: 200, thickness: 3 }, glassType: 'clear' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1, stations: ['cutting'],
  });
  const ordId = ordRes.data.data._id;

  // Create claim
  const claimRes = await api('POST', '/api/claims/from-pane', token, {
    paneNumber: pane.paneNumber,
    source: 'worker',
    description: 'Minor issue',
    defectCode: 'other',
    reportedBy: workerId,
  });
  const claimId = claimRes.data.data._id;

  // Reject claim
  const rejectRes = await api('PATCH', `/api/claims/${claimId}`, token, {
    status: 'rejected',
    approvedBy: workerId,
  });
  check('REJECT claim', rejectRes.status, 200);
  check('claim status is rejected', rejectRes.data.data.status, 'rejected');
  check('no remadePane on rejection', rejectRes.data.data.remadePane, null);

  // Cleanup
  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// 6. ALREADY-COMPLETED PANE NOT PULLED AGAIN
// ──────────────────────────────────────────────

async function testCompletedPaneNotPulledAgain(token) {
  console.log('\n=== Already-Completed Pane Not Re-Pulled ===\n');

  const me = await api('GET', '/api/auth/me', token);
  const workerId = me.data.data._id;

  const cust = await api('POST', '/api/customers', token, { name: 'Claim Complete Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', token, { name: 'Claim Complete Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', token, {
    customer: custId,
    details: { type: 'clear', quantity: 1 },
    panes: [{ routing: ['cutting'], glassType: 'clear' }],
  });
  const reqId = reqRes.data.data._id;
  const pane = reqRes.data.data.panes[0];

  const ordRes = await api('POST', '/api/orders', token, {
    customer: custId, material: matId, quantity: 1, request: reqId, paneCount: 1, stations: ['cutting'],
  });
  const ordId = ordRes.data.data._id;

  // Complete pane through all stations
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'complete' });
  await api('POST', `/api/panes/${pane.paneNumber}/scan`, token, { station: 'cutting', action: 'scan_out' });

  const paneBefore = await api('GET', `/api/panes/${pane._id}`, token);
  check('pane is completed', paneBefore.data.data.currentStatus, 'completed');
  check('pane at cutting (last station)', paneBefore.data.data.currentStation, 'cutting');

  // Create claim on already-completed pane (e.g. customer reports defect after delivery)
  const claimRes = await api('POST', `/api/orders/${ordId}/claims`, token, {
    source: 'customer',
    material: matId,
    description: 'Customer found scratch after delivery',
    defectCode: 'scratch',
    pane: pane._id,
    reportedBy: workerId,
  });
  check('CREATE claim on completed pane', claimRes.status, 201);
  const claimId = claimRes.data.data._id;

  // Pane should still be at its original station (not changed to 'claimed')
  // because pullPaneFromStation skips already-completed panes
  const paneAfter = await api('GET', `/api/panes/${pane._id}`, token);
  check('completed pane station unchanged', paneAfter.data.data.currentStation, 'cutting');
  check('completed pane status unchanged', paneAfter.data.data.currentStatus, 'completed');

  // Cleanup
  const logs = await api('GET', '/api/production-logs?limit=100', token);
  const scanLogs = logs.data.data.filter((l) =>
    String(l.pane?._id || l.pane) === String(pane._id)
  );
  if (scanLogs.length > 0) {
    await api('DELETE', '/api/production-logs', token, { ids: scanLogs.map((l) => l._id) });
  }

  const notifs = await api('GET', '/api/notifications?limit=100', token);
  const testNotifs = notifs.data.data.filter((n) =>
    n.type === 'pane_arrived' || n.type === 'claim_approved'
  );
  if (testNotifs.length > 0) {
    await api('DELETE', '/api/notifications', token, { ids: testNotifs.map((n) => n._id) });
  }

  await api('DELETE', `/api/claims/${claimId}`, token);
  await api('DELETE', `/api/panes/${pane._id}`, token);
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/requests/${reqId}`, token);
  await api('DELETE', `/api/materials/${matId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('=== Claim Remake Test Suite ===');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}`);

  await testClaimPullsPaneFromStation(token);
  await testClaimApprovalCreateRemake(token);
  await testKeepDecisionAlsoCreatesRemake(token);
  await testNoDuplicateRemake(token);
  await testRejectionNoRemake(token);
  await testCompletedPaneNotPulledAgain(token);

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
