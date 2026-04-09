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

async function getRoleIds(token) {
  const res = await api('GET', '/api/roles', token);
  const roles = res.data.data;
  const map = {};
  for (const r of roles) map[r.slug] = r._id;
  return map;
}

async function setupUsers(adminToken, roleIds) {
  const workers = await api('GET', '/api/workers', adminToken);
  const existing = workers.data.data.map((w) => w.username);

  if (!existing.includes('manager1')) {
    await api('POST', '/api/workers', adminToken, {
      name: 'Manager', username: 'manager1', password: 'manager123', position: 'manager', role: roleIds.manager,
    });
    console.log('   Created manager1');
  }

  if (!existing.includes('worker1')) {
    await api('POST', '/api/workers', adminToken, {
      name: 'Worker', username: 'worker1', password: 'worker123', position: 'operator', role: roleIds.worker,
    });
    console.log('   Created worker1');
  }
}

async function setupStations(adminToken) {
  const tmpl = await api('POST', '/api/station-templates', adminToken, {
    name: 'RBAC Template',
    uiSchema: {},
  });
  const tmplId = tmpl.data.data._id;
  const cutRes = await api('POST', '/api/stations', adminToken, {
    name: 'cutting',
    templateId: tmplId,
  });
  const polRes = await api('POST', '/api/stations', adminToken, {
    name: 'polishing',
    templateId: tmplId,
  });
  return {
    tmplId,
    cutting: cutRes.data.data._id,
    polishing: polRes.data.data._id,
  };
}

async function testWorkers(tokens, roleIds) {
  console.log('\n=== Workers (admin only for CUD) ===\n');

  const r1 = await api('GET', '/api/workers', tokens.admin);
  check('GET    /workers         (admin)', r1.status, 200);
  const r2 = await api('GET', '/api/workers', tokens.manager);
  check('GET    /workers         (manager)', r2.status, 200);
  const r3 = await api('GET', '/api/workers', tokens.worker);
  check('GET    /workers         (worker)', r3.status, 200);

  const body = { name: 'Temp', username: 'temp_rbac', password: 'temp123456', position: 'temp', role: roleIds.worker };

  const r4 = await api('POST', '/api/workers', tokens.admin, body);
  check('POST   /workers         (admin)', r4.status, 201);
  const tempId = r4.data.data?._id;

  const r5 = await api('POST', '/api/workers', tokens.manager, { ...body, username: 'temp2' });
  check('POST   /workers         (manager)', r5.status, 403);
  const r6 = await api('POST', '/api/workers', tokens.worker, { ...body, username: 'temp3' });
  check('POST   /workers         (worker)', r6.status, 403);

  if (tempId) {
    const r7 = await api('PATCH', `/api/workers/${tempId}`, tokens.manager, { name: 'Hacked' });
    check('PATCH  /workers/:id     (manager)', r7.status, 403);
    const r8 = await api('PATCH', `/api/workers/${tempId}`, tokens.worker, { name: 'Hacked' });
    check('PATCH  /workers/:id     (worker)', r8.status, 403);
    const r9 = await api('PATCH', `/api/workers/${tempId}`, tokens.admin, { name: 'Updated' });
    check('PATCH  /workers/:id     (admin)', r9.status, 200);

    const r10 = await api('DELETE', `/api/workers/${tempId}`, tokens.manager);
    check('DELETE /workers/:id     (manager)', r10.status, 403);
    const r11 = await api('DELETE', `/api/workers/${tempId}`, tokens.worker);
    check('DELETE /workers/:id     (worker)', r11.status, 403);
    const r12 = await api('DELETE', `/api/workers/${tempId}`, tokens.admin);
    check('DELETE /workers/:id     (admin)', r12.status, 200);
  }
}

async function testResource(tokens, name, path, createBody) {
  console.log(`\n=== ${name} (admin+manager CUD) ===\n`);

  const r1 = await api('GET', path, tokens.admin);
  check(`GET    ${path.padEnd(20)} (admin)`, r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check(`GET    ${path.padEnd(20)} (manager)`, r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check(`GET    ${path.padEnd(20)} (worker)`, r3.status, 200);

  const r4 = await api('POST', path, tokens.admin, createBody);
  check(`POST   ${path.padEnd(20)} (admin)`, r4.status, 201);
  const id1 = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.manager, createBody);
  check(`POST   ${path.padEnd(20)} (manager)`, r5.status, 201);
  const id2 = r5.data.data?._id;

  const r6 = await api('POST', path, tokens.worker, createBody);
  check(`POST   ${path.padEnd(20)} (worker)`, r6.status, 403);

  if (id1) {
    const r7 = await api('PATCH', `${path}/${id1}`, tokens.manager, { name: 'Updated' });
    check(`PATCH  ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (manager)`, r7.status, 200);
    const r8 = await api('PATCH', `${path}/${id1}`, tokens.worker, { name: 'Hacked' });
    check(`PATCH  ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (worker)`, r8.status, 403);

    const r9 = await api('DELETE', `${path}/${id1}`, tokens.worker);
    check(`DELETE ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (worker)`, r9.status, 403);
    const r10 = await api('DELETE', `${path}/${id1}`, tokens.manager);
    check(`DELETE ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (manager)`, r10.status, 200);
  }

  if (id2) {
    const r11 = await api('DELETE', `${path}/${id2}`, tokens.admin);
    check(`DELETE ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (admin)`, r11.status, 200);
  }

  return {};
}

async function testOrders(tokens, customerId, materialId, workerId, stns) {
  console.log('\n=== Orders (admin+manager CD, all update, worker sees own) ===\n');
  const path = '/api/orders';
  const body = {
    customer: customerId,
    material: materialId,
    quantity: 5,
    stations: [stns.cutting, stns.polishing],
    currentStationIndex: 0,
    notes: 'RBAC test order',
  };

  const r1 = await api('POST', path, tokens.admin, { ...body, assignedTo: workerId });
  check('POST   /orders              (admin)', r1.status, 201);
  const ordId = r1.data.data?._id;

  const r2 = await api('POST', path, tokens.manager, body);
  check('POST   /orders              (manager)', r2.status, 201);
  const ordId2 = r2.data.data?._id;

  const r3 = await api('POST', path, tokens.worker, body);
  check('POST   /orders              (worker)', r3.status, 403);

  const r4 = await api('GET', path, tokens.admin);
  check('GET    /orders              (admin)', r4.status, 200);
  const r5 = await api('GET', path, tokens.worker);
  check('GET    /orders              (worker — own only)', r5.status, 200);
  console.log(`          worker sees ${r5.data.data?.length || 0} order(s), admin sees ${r4.data.data?.length || 0}`);

  if (ordId) {
    const r6 = await api('PATCH', `${path}/${ordId}`, tokens.worker, {
      status: 'in_progress',
      currentStationIndex: 1,
      stationHistory: [{ station: stns.cutting, enteredAt: new Date().toISOString(), completedBy: workerId }],
      stationData: { [stns.cutting]: { result: 'pass' } },
      notes: 'Started production',
    });
    check('PATCH  /orders/:id          (worker — assigned, new fields)', r6.status, 200);

    if (ordId2) {
      const r7 = await api('PATCH', `${path}/${ordId2}`, tokens.worker, { status: 'in_progress' });
      check('PATCH  /orders/:id          (worker — not assigned)', r7.status, 403);
    }

    const r8 = await api('DELETE', `${path}/${ordId}`, tokens.worker);
    check('DELETE /orders/:id          (worker)', r8.status, 403);
    const r9 = await api('DELETE', `${path}/${ordId}`, tokens.manager);
    check('DELETE /orders/:id          (manager)', r9.status, 200);
  }

  if (ordId2) {
    await api('DELETE', `${path}/${ordId2}`, tokens.admin);
  }

  return { ordId };
}

async function testRequests(tokens, customerId) {
  console.log('\n=== Requests (all view, admin+manager CUD) ===\n');
  const path = '/api/requests';
  const body = { details: { type: 'cut', quantity: 5 }, customer: customerId };

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /requests            (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check('GET    /requests            (manager)', r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check('GET    /requests            (worker)', r3.status, 200);

  const r4 = await api('POST', path, tokens.admin, body);
  check('POST   /requests            (admin)', r4.status, 201);
  const reqId = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.manager, body);
  check('POST   /requests            (manager)', r5.status, 201);
  const reqId2 = r5.data.data?._id;

  const r6 = await api('POST', path, tokens.worker, body);
  check('POST   /requests            (worker)', r6.status, 403);

  if (reqId) {
    const r7 = await api('PATCH', `${path}/${reqId}`, tokens.manager, { deliveryLocation: 'Updated' });
    check('PATCH  /requests/:id        (manager)', r7.status, 200);
    const r8 = await api('PATCH', `${path}/${reqId}`, tokens.worker, { deliveryLocation: 'Hacked' });
    check('PATCH  /requests/:id        (worker)', r8.status, 403);

    const r9 = await api('DELETE', `${path}/${reqId}`, tokens.worker);
    check('DELETE /requests/:id        (worker)', r9.status, 403);
    const r10 = await api('DELETE', `${path}/${reqId}`, tokens.manager);
    check('DELETE /requests/:id        (manager)', r10.status, 200);
  }

  if (reqId2) await api('DELETE', `${path}/${reqId2}`, tokens.admin);
}

async function testWithdrawals(tokens, materialId, workerId) {
  console.log('\n=== Withdrawals (all create, admin+manager update/delete, worker sees own) ===\n');
  const path = '/api/withdrawals';

  const inv = await api('POST', '/api/inventories', tokens.admin, {
    material: materialId, stockType: 'Raw', quantity: 100, location: 'RBAC Test Warehouse',
  });
  const invId = inv.data.data?._id;

  const body = { withdrawnBy: workerId, material: materialId, quantity: 2, stockType: 'Raw', notes: 'RBAC test withdrawal' };

  const r1 = await api('POST', path, tokens.admin, body);
  check('POST   /withdrawals         (admin)', r1.status, 201);
  const wdId = r1.data.data?._id;

  const r2 = await api('POST', path, tokens.manager, body);
  check('POST   /withdrawals         (manager)', r2.status, 201);

  const r3 = await api('POST', path, tokens.worker, body);
  check('POST   /withdrawals         (worker)', r3.status, 201);
  const wdId3 = r3.data.data?._id;

  const r4 = await api('GET', path, tokens.admin);
  check('GET    /withdrawals         (admin)', r4.status, 200);
  const r5 = await api('GET', path, tokens.worker);
  check('GET    /withdrawals         (worker — own only)', r5.status, 200);
  console.log(`          worker sees ${r5.data.data?.length || 0} withdrawal(s), admin sees ${r4.data.data?.length || 0}`);

  if (wdId) {
    const r6 = await api('PATCH', `${path}/${wdId}`, tokens.worker, { quantity: 99 });
    check('PATCH  /withdrawals/:id     (worker)', r6.status, 403);
    const r7 = await api('PATCH', `${path}/${wdId}`, tokens.manager, { quantity: 10, notes: 'Updated by manager' });
    check('PATCH  /withdrawals/:id     (manager, with notes)', r7.status, 200);

    const r8 = await api('DELETE', `${path}/${wdId}`, tokens.worker);
    check('DELETE /withdrawals/:id     (worker)', r8.status, 403);
    const r9 = await api('DELETE', `${path}/${wdId}`, tokens.manager);
    check('DELETE /withdrawals/:id     (manager)', r9.status, 200);
  }

  // cleanup
  const all = await api('GET', path, tokens.admin);
  if (all.data.data?.length) {
    await api('DELETE', path, tokens.admin, { ids: all.data.data.map((w) => w._id) });
  }
  if (invId) await api('DELETE', `/api/inventories/${invId}`, tokens.admin);
}

async function testClaims(tokens, customerId, materialId, workerId, adminId) {
  console.log('\n=== Claims (all create/update own, admin+manager delete, worker sees own) ===\n');

  const ord = await api('POST', '/api/orders', tokens.admin, {
    customer: customerId, material: materialId, quantity: 5, assignedTo: workerId,
  });
  const ordId = ord.data.data?._id;

  const r1 = await api('POST', `/api/orders/${ordId}/claims`, tokens.admin, {
    source: 'worker', material: materialId, description: 'Admin claim', reportedBy: adminId,
  });
  check('POST   /orders/:id/claims   (admin)', r1.status, 201);
  const claimId = r1.data.data?._id;

  const r2 = await api('POST', `/api/orders/${ordId}/claims`, tokens.worker, {
    source: 'worker', material: materialId, description: 'Worker claim', reportedBy: workerId,
  });
  check('POST   /orders/:id/claims   (worker)', r2.status, 201);
  const claimId2 = r2.data.data?._id;

  const r3 = await api('GET', '/api/claims', tokens.admin);
  check('GET    /claims              (admin)', r3.status, 200);
  const r4 = await api('GET', '/api/claims', tokens.worker);
  check('GET    /claims              (worker — own only)', r4.status, 200);
  console.log(`          worker sees ${r4.data.data?.length || 0} claim(s), admin sees ${r3.data.data?.length || 0}`);

  if (claimId2) {
    const r5 = await api('PATCH', `/api/claims/${claimId2}`, tokens.worker, { description: 'Updated by worker' });
    check('PATCH  /claims/:id          (worker — own)', r5.status, 200);
  }
  if (claimId) {
    const r6 = await api('PATCH', `/api/claims/${claimId}`, tokens.worker, { description: 'Hacked' });
    check('PATCH  /claims/:id          (worker — not own)', r6.status, 403);
  }

  const r7 = await api('DELETE', `/api/claims/${claimId}`, tokens.worker);
  check('DELETE /claims/:id          (worker)', r7.status, 403);
  const r8 = await api('DELETE', `/api/claims/${claimId}`, tokens.manager);
  check('DELETE /claims/:id          (manager)', r8.status, 200);

  // cleanup
  if (claimId2) await api('DELETE', `/api/claims/${claimId2}`, tokens.admin);
  if (ordId) await api('DELETE', `/api/orders/${ordId}`, tokens.admin);
}

async function testPaneLogs(tokens) {
  console.log('\n=== Pane Logs (all roles — pane_logs:view) ===\n');

  const r1 = await api('GET', '/api/pane-logs?limit=5', tokens.admin);
  check('GET    /pane-logs           (admin)', r1.status, 200);

  const r2 = await api('GET', '/api/pane-logs?limit=5', tokens.manager);
  check('GET    /pane-logs           (manager)', r2.status, 200);

  const r3 = await api('GET', '/api/pane-logs?limit=5', tokens.worker);
  check('GET    /pane-logs           (worker)', r3.status, 200);
}

async function testMaterialLogs(tokens, materialId) {
  console.log('\n=== Material Logs (admin+manager CUD) ===\n');
  const path = '/api/material-logs';
  const body = { material: materialId, actionType: 'import', quantityChanged: 50 };

  const r1 = await api('POST', path, tokens.admin, body);
  check('POST   /material-logs       (admin)', r1.status, 201);
  const logId = r1.data.data?._id;

  const r2 = await api('POST', path, tokens.manager, body);
  check('POST   /material-logs       (manager)', r2.status, 201);
  const logId2 = r2.data.data?._id;

  const r3 = await api('POST', path, tokens.worker, body);
  check('POST   /material-logs       (worker)', r3.status, 403);

  const r4 = await api('GET', path, tokens.worker);
  check('GET    /material-logs       (worker)', r4.status, 200);

  if (logId) {
    const r5 = await api('PATCH', `${path}/${logId}`, tokens.worker, { quantityChanged: 99 });
    check('PATCH  /material-logs/:id   (worker)', r5.status, 403);
    const r6 = await api('PATCH', `${path}/${logId}`, tokens.manager, { quantityChanged: 75 });
    check('PATCH  /material-logs/:id   (manager)', r6.status, 200);

    const r7 = await api('DELETE', `${path}/${logId}`, tokens.worker);
    check('DELETE /material-logs/:id   (worker)', r7.status, 403);
    const r8 = await api('DELETE', `${path}/${logId}`, tokens.manager);
    check('DELETE /material-logs/:id   (manager)', r8.status, 200);
  }

  if (logId2) {
    const r9 = await api('DELETE', `${path}/${logId2}`, tokens.admin);
    check('DELETE /material-logs/:id   (admin)', r9.status, 200);
  }
}

async function testNotifications(tokens, workerId) {
  console.log('\n=== Notifications (admin+manager create/delete, worker sees/updates own) ===\n');
  const path = '/api/notifications';
  const body = { recipient: workerId, type: 'info', title: 'Test notification' };

  const r1 = await api('POST', path, tokens.admin, body);
  check('POST   /notifications       (admin)', r1.status, 201);
  const notifId = r1.data.data?._id;

  const r2 = await api('POST', path, tokens.manager, body);
  check('POST   /notifications       (manager)', r2.status, 201);
  const notifId2 = r2.data.data?._id;

  const r3 = await api('POST', path, tokens.worker, body);
  check('POST   /notifications       (worker)', r3.status, 403);

  const r4 = await api('GET', path, tokens.admin);
  check('GET    /notifications       (admin)', r4.status, 200);
  const r5 = await api('GET', path, tokens.worker);
  check('GET    /notifications       (worker — own only)', r5.status, 200);
  console.log(`          worker sees ${r5.data.data?.length || 0} notification(s), admin sees ${r4.data.data?.length || 0}`);

  if (notifId) {
    const r6 = await api('PATCH', `${path}/${notifId}`, tokens.worker, { readStatus: true });
    check('PATCH  /notifications/:id   (worker — own)', r6.status, 200);
  }

  const r7 = await api('DELETE', `${path}/${notifId}`, tokens.worker);
  check('DELETE /notifications/:id   (worker)', r7.status, 403);
  const r8 = await api('DELETE', `${path}/${notifId}`, tokens.manager);
  check('DELETE /notifications/:id   (manager)', r8.status, 200);

  if (notifId2) await api('DELETE', `${path}/${notifId2}`, tokens.admin);
}

async function testPanes(tokens, customerId, materialId, stns) {
  console.log('\n=== Panes (admin+manager CUD) ===\n');
  const path = '/api/panes';

  const ord = await api('POST', '/api/orders', tokens.admin, { customer: customerId, material: materialId, quantity: 5 });
  const ordId = ord.data.data._id;
  const body = { order: ordId, dimensions: { width: 800, height: 600, thickness: 5 }, glassType: 'tempered' };

  const r1 = await api('GET', `${path}?order=${ordId}`, tokens.admin);
  check('GET    /panes               (admin)', r1.status, 200);
  const r2 = await api('GET', `${path}?order=${ordId}`, tokens.manager);
  check('GET    /panes               (manager)', r2.status, 200);
  const r3 = await api('GET', `${path}?order=${ordId}`, tokens.worker);
  check('GET    /panes               (worker)', r3.status, 200);

  const r4 = await api('POST', path, tokens.admin, body);
  check('POST   /panes               (admin)', r4.status, 201);
  const paneId = r4.data.data?._id;
  check('  has paneNumber', typeof r4.data.data?.paneNumber, 'string');
  check('  has qrCode', typeof r4.data.data?.qrCode, 'string');

  const r5 = await api('POST', path, tokens.manager, body);
  check('POST   /panes               (manager)', r5.status, 201);
  const paneId2 = r5.data.data?._id;

  const r6 = await api('POST', path, tokens.worker, body);
  check('POST   /panes               (worker)', r6.status, 403);

  if (paneId) {
    const r7 = await api('PATCH', `${path}/${paneId}`, tokens.manager, { currentStation: stns.cutting });
    check('PATCH  /panes/:id           (manager)', r7.status, 200);
    const r8 = await api('PATCH', `${path}/${paneId}`, tokens.worker, { currentStation: stns.polishing });
    check('PATCH  /panes/:id           (worker)', r8.status, 403);

    const r9 = await api('DELETE', `${path}/${paneId}`, tokens.worker);
    check('DELETE /panes/:id           (worker)', r9.status, 403);
    const r10 = await api('DELETE', `${path}/${paneId}`, tokens.manager);
    check('DELETE /panes/:id           (manager)', r10.status, 200);
  }

  if (paneId2) {
    const r11 = await api('DELETE', `${path}/${paneId2}`, tokens.admin);
    check('DELETE /panes/:id           (admin)', r11.status, 200);
  }

  await api('DELETE', `/api/orders/${ordId}`, tokens.admin);
}

async function testProductionLogs(tokens, customerId, materialId, stns) {
  console.log('\n=== Production Logs (all create, admin+manager update/delete) ===\n');
  const path = '/api/production-logs';

  const me = await api('GET', '/api/auth/me', tokens.worker);
  const workerId = me.data.data._id;

  const ord = await api('POST', '/api/orders', tokens.admin, { customer: customerId, material: materialId, quantity: 1 });
  const ordId = ord.data.data._id;
  const pane = await api('POST', '/api/panes', tokens.admin, { order: ordId });
  const paneId = pane.data.data._id;

  const body = { pane: paneId, order: ordId, station: stns.cutting, action: 'scan_in', operator: workerId };

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /production-logs     (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.worker);
  check('GET    /production-logs     (worker)', r2.status, 200);

  const r3 = await api('POST', path, tokens.admin, body);
  check('POST   /production-logs     (admin)', r3.status, 201);
  const logId = r3.data.data?._id;

  const r4 = await api('POST', path, tokens.manager, { ...body, action: 'start' });
  check('POST   /production-logs     (manager)', r4.status, 201);
  const logId2 = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.worker, { ...body, action: 'complete' });
  check('POST   /production-logs     (worker)', r5.status, 201);
  const logId3 = r5.data.data?._id;

  if (logId) {
    const r6 = await api('PATCH', `${path}/${logId}`, tokens.manager, { status: 'pass' });
    check('PATCH  /production-logs/:id (manager)', r6.status, 200);
    const r7 = await api('PATCH', `${path}/${logId}`, tokens.worker, { status: 'fail' });
    check('PATCH  /production-logs/:id (worker)', r7.status, 403);

    const r8 = await api('DELETE', `${path}/${logId}`, tokens.worker);
    check('DELETE /production-logs/:id (worker)', r8.status, 403);
    const r9 = await api('DELETE', `${path}/${logId}`, tokens.manager);
    check('DELETE /production-logs/:id (manager)', r9.status, 200);
  }

  if (logId2) {
    const r10 = await api('DELETE', `${path}/${logId2}`, tokens.admin);
    check('DELETE /production-logs/:id (admin)', r10.status, 200);
  }
  if (logId3) await api('DELETE', `${path}/${logId3}`, tokens.admin);
  await api('DELETE', `/api/panes/${paneId}`, tokens.admin);
  await api('DELETE', `/api/orders/${ordId}`, tokens.admin);
}

async function testNotificationPreferences(tokens) {
  console.log('\n=== Notification Preferences (self-update via /auth/me) ===\n');

  // Worker can read their own preferences via GET /auth/me
  const r1 = await api('GET', '/api/auth/me', tokens.worker);
  check('GET    /auth/me has notificationPreferences', r1.data.data.notificationPreferences !== undefined, true);
  check('  defaults — enabled', r1.data.data.notificationPreferences.enabled, true);
  check('  defaults — volume', r1.data.data.notificationPreferences.volume, 0.6);
  check('  defaults — sounds.low', r1.data.data.notificationPreferences.sounds.low, 'soft_pop');
  check('  defaults — sounds.medium', r1.data.data.notificationPreferences.sounds.medium, 'ding');
  check('  defaults — sounds.high', r1.data.data.notificationPreferences.sounds.high, 'alert');

  // Worker can update their own preferences (partial update)
  const r2 = await api('PATCH', '/api/auth/me', tokens.worker, {
    notificationPreferences: { volume: 0.9 },
  });
  check('PATCH  /auth/me notifPrefs volume  (worker)', r2.status, 200);

  // Verify volume changed but sounds stayed
  const r3 = await api('GET', '/api/auth/me', tokens.worker);
  check('  volume updated', r3.data.data.notificationPreferences.volume, 0.9);
  check('  sounds.low preserved', r3.data.data.notificationPreferences.sounds.low, 'soft_pop');

  // Worker can update sounds partially
  const r4 = await api('PATCH', '/api/auth/me', tokens.worker, {
    notificationPreferences: { sounds: { high: 'siren' } },
  });
  check('PATCH  /auth/me notifPrefs sounds  (worker)', r4.status, 200);

  const r5 = await api('GET', '/api/auth/me', tokens.worker);
  check('  sounds.high updated', r5.data.data.notificationPreferences.sounds.high, 'siren');
  check('  volume still 0.9', r5.data.data.notificationPreferences.volume, 0.9);

  // Worker can disable notifications
  const r6 = await api('PATCH', '/api/auth/me', tokens.worker, {
    notificationPreferences: { enabled: false },
  });
  check('PATCH  /auth/me disable notifs     (worker)', r6.status, 200);

  const r7 = await api('GET', '/api/auth/me', tokens.worker);
  check('  enabled is false', r7.data.data.notificationPreferences.enabled, false);

  // Admin can update worker's preferences via /api/workers/:id
  const me = await api('GET', '/api/auth/me', tokens.worker);
  const workerId = me.data.data._id;

  const r8 = await api('PATCH', `/api/workers/${workerId}`, tokens.admin, {
    notificationPreferences: { volume: 0.3 },
  });
  check('PATCH  /workers/:id notifPrefs     (admin)', r8.status, 200);

  const r9 = await api('GET', '/api/auth/me', tokens.worker);
  check('  volume set by admin', r9.data.data.notificationPreferences.volume, 0.3);

  // Restore defaults for worker
  await api('PATCH', `/api/workers/${workerId}`, tokens.admin, {
    notificationPreferences: { enabled: true, volume: 0.6, sounds: { low: 'soft_pop', medium: 'ding', high: 'alert', urgent: 'alert' } },
  });
}

async function testStickerTemplates(tokens) {
  console.log('\n=== Sticker Templates (admin+manager CUD) ===\n');
  const path = '/api/sticker-templates';
  const body = { width: 100, height: 50, elements: [{ type: 'text', value: 'test' }] };

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /sticker-templates   (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check('GET    /sticker-templates   (manager)', r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check('GET    /sticker-templates   (worker)', r3.status, 200);

  const r4 = await api('POST', path, tokens.admin, { ...body, name: 'rbac-admin' });
  check('POST   /sticker-templates   (admin)', r4.status, 201);
  const id1 = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.manager, { ...body, name: 'rbac-manager' });
  check('POST   /sticker-templates   (manager)', r5.status, 201);
  const id2 = r5.data.data?._id;

  const r6 = await api('POST', path, tokens.worker, { ...body, name: 'rbac-worker' });
  check('POST   /sticker-templates   (worker)', r6.status, 403);

  if (id1) {
    const r7 = await api('PATCH', `${path}/${id1}`, tokens.manager, { width: 200 });
    check('PATCH  /sticker-templates/:id (manager)', r7.status, 200);
    const r8 = await api('PATCH', `${path}/${id1}`, tokens.worker, { width: 300 });
    check('PATCH  /sticker-templates/:id (worker)', r8.status, 403);

    const r9 = await api('DELETE', `${path}/${id1}`, tokens.worker);
    check('DELETE /sticker-templates/:id (worker)', r9.status, 403);
    const r10 = await api('DELETE', `${path}/${id1}`, tokens.manager);
    check('DELETE /sticker-templates/:id (manager)', r10.status, 200);
  }

  if (id2) {
    const r11 = await api('DELETE', `${path}/${id2}`, tokens.admin);
    check('DELETE /sticker-templates/:id (admin)', r11.status, 200);
  }
}

async function testPricingSettings(tokens) {
  console.log('\n=== Pricing Settings (all read, admin+manager update) ===\n');
  const path = '/api/pricing-settings';

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /pricing-settings    (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check('GET    /pricing-settings    (manager)', r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check('GET    /pricing-settings    (worker)', r3.status, 200);

  const r4 = await api('PUT', path, tokens.admin, { holePriceEach: 75 });
  check('PUT    /pricing-settings    (admin)', r4.status, 200);

  const r5 = await api('PUT', path, tokens.manager, { holePriceEach: 80 });
  check('PUT    /pricing-settings    (manager)', r5.status, 200);

  const r6 = await api('PUT', path, tokens.worker, { holePriceEach: 99 });
  check('PUT    /pricing-settings    (worker)', r6.status, 403);

  // Restore default
  await api('PUT', path, tokens.admin, { holePriceEach: 50 });
}

async function testRoles(tokens) {
  console.log('\n=== Roles (admin only for CUD, system role protection) ===\n');
  const path = '/api/roles';

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /roles               (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check('GET    /roles               (manager)', r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check('GET    /roles               (worker)', r3.status, 200);

  // GET /roles/permissions
  const r3b = await api('GET', `${path}/permissions`, tokens.admin);
  check('GET    /roles/permissions   (admin)', r3b.status, 200);
  check('  returns array', Array.isArray(r3b.data.data), true);
  const r3c = await api('GET', `${path}/permissions`, tokens.worker);
  check('GET    /roles/permissions   (worker)', r3c.status, 200);

  const body = { name: 'RBAC Test Role', slug: 'rbac_test', permissions: ['workers:view', 'customers:view'] };

  const r4 = await api('POST', path, tokens.admin, body);
  check('POST   /roles               (admin)', r4.status, 201);
  const roleId = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.manager, { ...body, slug: 'rbac_test_m' });
  check('POST   /roles               (manager)', r5.status, 403);
  const r6 = await api('POST', path, tokens.worker, { ...body, slug: 'rbac_test_w' });
  check('POST   /roles               (worker)', r6.status, 403);

  if (roleId) {
    const r7 = await api('PATCH', `${path}/${roleId}`, tokens.manager, { name: 'Hacked' });
    check('PATCH  /roles/:id           (manager)', r7.status, 403);
    const r8 = await api('PATCH', `${path}/${roleId}`, tokens.worker, { name: 'Hacked' });
    check('PATCH  /roles/:id           (worker)', r8.status, 403);
    const r9 = await api('PATCH', `${path}/${roleId}`, tokens.admin, { name: 'Updated Test Role' });
    check('PATCH  /roles/:id           (admin)', r9.status, 200);

    // System role protection: cannot delete system roles
    const systemRoles = r1.data.data.filter(r => r.isSystem);
    if (systemRoles.length > 0) {
      const sysId = systemRoles[0]._id;
      const r10 = await api('DELETE', `${path}/${sysId}`, tokens.admin);
      check('DELETE /roles/:id (system)    (admin)', r10.status, 400);
    }

    // Duplicate slug
    const r11 = await api('POST', path, tokens.admin, { name: 'Dup Role', slug: 'rbac_test', permissions: [] });
    check('POST   /roles (dup slug)    (admin)', r11.status, 409);

    const r12 = await api('DELETE', `${path}/${roleId}`, tokens.worker);
    check('DELETE /roles/:id           (worker)', r12.status, 403);
    const r13 = await api('DELETE', `${path}/${roleId}`, tokens.manager);
    check('DELETE /roles/:id           (manager)', r13.status, 403);
    const r14 = await api('DELETE', `${path}/${roleId}`, tokens.admin);
    check('DELETE /roles/:id           (admin)', r14.status, 200);
  }
}

async function testInventoryMove(tokens, materialId) {
  console.log('\n=== Inventory Move (admin+manager+worker can move) ===\n');

  const inv1 = await api('POST', '/api/inventories', tokens.admin, {
    material: materialId, stockType: 'Raw', quantity: 100, location: 'RBAC Move Source',
  });
  const inv1Id = inv1.data.data?._id;

  if (inv1Id) {
    const r1 = await api('POST', `/api/inventories/${inv1Id}/move`, tokens.worker, {
      quantity: 5, toLocation: 'RBAC Move Dest Worker',
    });
    check('POST   /inventories/:id/move (worker)', r1.status, 200);

    const r2 = await api('POST', `/api/inventories/${inv1Id}/move`, tokens.manager, {
      quantity: 5, toLocation: 'RBAC Move Dest Manager',
    });
    check('POST   /inventories/:id/move (manager)', r2.status, 200);

    const r3 = await api('POST', `/api/inventories/${inv1Id}/move`, tokens.admin, {
      quantity: 5, toLocation: 'RBAC Move Dest Admin',
    });
    check('POST   /inventories/:id/move (admin)', r3.status, 200);

    // Cleanup created inventories
    const allInv = await api('GET', '/api/inventories?limit=100', tokens.admin);
    const testInvs = allInv.data.data.filter(i => i.location?.startsWith('RBAC Move'));
    for (const inv of testInvs) {
      await api('DELETE', `/api/inventories/${inv._id}`, tokens.admin);
    }
  }
}

async function testBatchScanRbac(tokens, stns) {
  console.log('\n=== Batch Scan RBAC (all roles with panes:scan can batch-scan) ===\n');

  const cust = await api('POST', '/api/customers', tokens.admin, { name: 'BatchScan RBAC Cust' });
  const custId = cust.data.data._id;
  const mat = await api('POST', '/api/materials', tokens.admin, { name: 'BatchScan RBAC Mat', unit: 'sheet', reorderPoint: 5 });
  const matId = mat.data.data._id;

  const reqRes = await api('POST', '/api/requests', tokens.admin, {
    customer: custId,
    details: { type: 'tempered', quantity: 3 },
    panes: [
      { routing: [stns.cutting, stns.polishing], glassType: 'tempered' },
      { routing: [stns.cutting, stns.polishing], glassType: 'tempered' },
      { routing: [stns.cutting, stns.polishing], glassType: 'tempered' },
    ],
  });
  const reqId = reqRes.data.data._id;
  const paneNumbers = reqRes.data.data.panes.map(p => p.paneNumber);
  const paneIds = reqRes.data.data.panes.map(p => p._id);

  const ordRes = await api('POST', '/api/orders', tokens.admin, {
    customer: custId, material: matId, quantity: 3, request: reqId, paneCount: 3,
  });
  const ordId = ordRes.data.data._id;

  // batch-scan uses MongoDB transactions which require a replica set.
  // If the dev DB is standalone, all calls return 500 (transaction infra error).
  // The RBAC check happens before the transaction, so we verify no role gets 403.
  const r1 = await api('POST', '/api/panes/batch-scan', tokens.worker, {
    paneNumbers: [paneNumbers[0]], station: stns.cutting, action: 'scan_in',
  });
  check('POST   /panes/batch-scan   (worker) — not 403', r1.status !== 403, true);

  const r2 = await api('POST', '/api/panes/batch-scan', tokens.manager, {
    paneNumbers: [paneNumbers[1]], station: stns.cutting, action: 'scan_in',
  });
  check('POST   /panes/batch-scan   (manager) — not 403', r2.status !== 403, true);

  const r3 = await api('POST', '/api/panes/batch-scan', tokens.admin, {
    paneNumbers: [paneNumbers[2]], station: stns.cutting, action: 'scan_in',
  });
  check('POST   /panes/batch-scan   (admin) — not 403', r3.status !== 403, true);

  if (r1.status === 200 && r2.status === 200 && r3.status === 200) {
    console.log('          (all returned 200 — transactions supported)');
  } else {
    console.log('          (some returned 500 — likely standalone MongoDB without replica set)');
  }

  // Cleanup
  for (const id of paneIds) await api('DELETE', `/api/panes/${id}`, tokens.admin);
  await api('DELETE', `/api/orders/${ordId}`, tokens.admin);
  await api('DELETE', `/api/requests/${reqId}`, tokens.admin);
  await api('DELETE', `/api/materials/${matId}`, tokens.admin);
  await api('DELETE', `/api/customers/${custId}`, tokens.admin);
}

async function testAuthEdgeCases(tokens) {
  console.log('\n=== Auth Edge Cases ===\n');

  // No token
  const r1 = await api('GET', '/api/workers', null);
  check('GET    /workers (no token)', r1.status, 401);

  // Malformed Bearer header
  const r2 = await fetch(`${API}/api/workers`, {
    headers: { Authorization: 'Bearer' },
  });
  check('GET    /workers (empty Bearer)', r2.status, 401);

  // Invalid token
  const r3 = await api('GET', '/api/workers', 'invalid-token-string');
  check('GET    /workers (invalid token)', r3.status, 401);

  // Logout (stateless — should return 200)
  const r4 = await api('POST', '/api/auth/logout', tokens.worker);
  check('POST   /auth/logout (worker)', r4.status, 200);

  // Invalid login
  const r5 = await api('POST', '/api/auth/login', null, { username: 'admin', password: 'wrongpass' });
  check('POST   /auth/login (bad password)', r5.status, 401);

  const r6 = await api('POST', '/api/auth/login', null, { username: 'nonexistent', password: 'test123' });
  check('POST   /auth/login (bad username)', r6.status, 401);

  // Missing fields
  const r7 = await api('POST', '/api/auth/login', null, { username: 'admin' });
  check('POST   /auth/login (missing password)', r7.status, 400);

  const r8 = await api('POST', '/api/auth/login', null, {});
  check('POST   /auth/login (empty body)', r8.status, 400);
}

async function testAuthUpdateMe(tokens) {
  console.log('\n=== Auth Update Me (name & username) ===\n');

  const r1 = await api('PATCH', '/api/auth/me', tokens.worker, { name: 'Worker Updated Name' });
  check('PATCH  /auth/me name          (worker)', r1.status, 200);

  const r2 = await api('GET', '/api/auth/me', tokens.worker);
  check('  name updated', r2.data.data.name, 'Worker Updated Name');

  const r3 = await api('PATCH', '/api/auth/me', tokens.worker, { username: 'worker1_updated' });
  check('PATCH  /auth/me username      (worker)', r3.status, 200);

  const r4 = await api('GET', '/api/auth/me', tokens.worker);
  check('  username updated', r4.data.data.username, 'worker1_updated');

  await api('PATCH', '/api/auth/me', tokens.worker, { name: 'Worker', username: 'worker1' });

  const r5 = await api('GET', '/api/auth/me', tokens.worker);
  check('  name restored', r5.data.data.name, 'Worker');
  check('  username restored', r5.data.data.username, 'worker1');
}

async function testJobTypeRbac(tokens) {
  console.log('\n=== Job Types (admin+manager CUD) ===\n');
  const path = '/api/job-types';

  const r1 = await api('GET', path, tokens.admin);
  check('GET    /job-types           (admin)', r1.status, 200);
  const r2 = await api('GET', path, tokens.manager);
  check('GET    /job-types           (manager)', r2.status, 200);
  const r3 = await api('GET', path, tokens.worker);
  check('GET    /job-types           (worker)', r3.status, 200);

  const body = { name: 'RBAC Test Type', code: 'RBAC_TEST' };

  const r4 = await api('POST', path, tokens.admin, body);
  check('POST   /job-types           (admin)', r4.status, 201);
  const id1 = r4.data.data?._id;

  const r5 = await api('POST', path, tokens.manager, { ...body, code: 'RBAC_TEST_M' });
  check('POST   /job-types           (manager)', r5.status, 201);
  const id2 = r5.data.data?._id;

  const r6 = await api('POST', path, tokens.worker, { ...body, code: 'RBAC_TEST_W' });
  check('POST   /job-types           (worker)', r6.status, 403);

  if (id1) {
    const r7 = await api('PATCH', `${path}/${id1}`, tokens.manager, { name: 'Updated' });
    check('PATCH  /job-types/:id       (manager)', r7.status, 200);
    const r8 = await api('PATCH', `${path}/${id1}`, tokens.worker, { name: 'Hacked' });
    check('PATCH  /job-types/:id       (worker)', r8.status, 403);

    const r9 = await api('DELETE', `${path}/${id1}`, tokens.worker);
    check('DELETE /job-types/:id       (worker)', r9.status, 403);
    const r10 = await api('DELETE', `${path}/${id1}`, tokens.manager);
    check('DELETE /job-types/:id       (manager)', r10.status, 200);
  }

  if (id2) {
    const r11 = await api('DELETE', `${path}/${id2}`, tokens.admin);
    check('DELETE /job-types/:id       (admin)', r11.status, 200);
  }
}

async function main() {
  console.log('=== RBAC Test Suite ===\n');

  const adminToken = await login('admin', 'admin123');
  const snapshot = await snapshotIds(API, adminToken);

  try {
    console.log('Setting up users...');
    const roleIds = await getRoleIds(adminToken);
    await setupUsers(adminToken, roleIds);
    const stns = await setupStations(adminToken);

    const managerToken = await login('manager1', 'manager123');
    const workerToken = await login('worker1', 'worker123');
    const tokens = { admin: adminToken, manager: managerToken, worker: workerToken };

    console.log('   Admin token:   ...', adminToken.slice(-10));
    console.log('   Manager token: ...', managerToken.slice(-10));
    console.log('   Worker token:  ...', workerToken.slice(-10));

    const me = await api('GET', '/api/auth/me', workerToken);
    const workerId = me.data.data._id;
    const adminMe = await api('GET', '/api/auth/me', adminToken);
    const adminId = adminMe.data.data._id;

    // Test Workers
    await testWorkers(tokens, roleIds);

    // Test Customers, Materials, Station Templates (same pattern)
    const custResult = await testResource(tokens, 'Customers', '/api/customers',
      { name: 'Test Customer', phone: '0812345678' });
    const matResult = await testResource(tokens, 'Materials', '/api/materials',
      { name: 'Test Glass', unit: 'sheet', reorderPoint: 5 });
    await testResource(tokens, 'Station Templates', '/api/station-templates',
      { name: 'Test Template', uiSchema: {} });

    // Need a material for inventory, a template for stations
    const mat = await api('POST', '/api/materials', adminToken,
      { name: 'RBAC Test Mat', unit: 'sheet', reorderPoint: 5 });
    const matId = mat.data.data._id;
    const cust = await api('POST', '/api/customers', adminToken, { name: 'RBAC Test Customer' });
    const custId = cust.data.data._id;
    const tmpl = await api('POST', '/api/station-templates', adminToken, { name: 'RBAC Test Template' });
    const tmplId = tmpl.data.data._id;

    await testResource(tokens, 'Inventories', '/api/inventories',
      { material: matId, stockType: 'Raw', quantity: 100, location: 'Warehouse A' });
    await testResource(tokens, 'Stations', '/api/stations',
      { name: 'Cutting Station', templateId: tmplId });

    // Test resources with ownership
    await testMaterialLogs(tokens, matId);
    await testPaneLogs(tokens);
    await testOrders(tokens, custId, matId, workerId, stns);
    await testRequests(tokens, custId);
    await testWithdrawals(tokens, matId, workerId);
    await testClaims(tokens, custId, matId, workerId, adminId);
    await testPanes(tokens, custId, matId, stns);
    await testProductionLogs(tokens, custId, matId, stns);
    await testNotifications(tokens, workerId);
    await testNotificationPreferences(tokens);
    await testStickerTemplates(tokens);
    await testPricingSettings(tokens);
    await testAuthUpdateMe(tokens);
    await testJobTypeRbac(tokens);
    await testRoles(tokens);
    await testInventoryMove(tokens, matId);
    await testBatchScanRbac(tokens, stns);
    await testAuthEdgeCases(tokens);
  } finally {
    await sweepCreatedData(API, adminToken, snapshot);
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
