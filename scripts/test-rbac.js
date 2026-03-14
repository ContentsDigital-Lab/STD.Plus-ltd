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

async function setupUsers(adminToken) {
  const workers = await api('GET', '/api/workers', adminToken);
  const existing = workers.data.data.map((w) => w.username);

  if (!existing.includes('manager1')) {
    await api('POST', '/api/workers', adminToken, {
      name: 'Manager', username: 'manager1', password: 'manager123', position: 'manager', role: 'manager',
    });
    console.log('   Created manager1');
  }

  if (!existing.includes('worker1')) {
    await api('POST', '/api/workers', adminToken, {
      name: 'Worker', username: 'worker1', password: 'worker123', position: 'operator', role: 'worker',
    });
    console.log('   Created worker1');
  }
}

async function testWorkers(tokens) {
  console.log('\n=== Workers (admin only for CUD) ===\n');

  const r1 = await api('GET', '/api/workers', tokens.admin);
  check('GET    /workers         (admin)', r1.status, 200);
  const r2 = await api('GET', '/api/workers', tokens.manager);
  check('GET    /workers         (manager)', r2.status, 200);
  const r3 = await api('GET', '/api/workers', tokens.worker);
  check('GET    /workers         (worker)', r3.status, 200);

  const body = { name: 'Temp', username: 'temp_rbac', password: 'temp123456', position: 'temp' };

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
  console.log(`\n=== ${name} (admin+manager CU, admin-only D) ===\n`);

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
    check(`DELETE ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (manager)`, r10.status, 403);
    const r11 = await api('DELETE', `${path}/${id1}`, tokens.admin);
    check(`DELETE ${path}/:id${' '.repeat(Math.max(0, 14 - path.length))} (admin)`, r11.status, 200);
  }

  return { id: r5.data.data?._id };
}

async function testOrders(tokens, customerId, materialId, workerId) {
  console.log('\n=== Orders (admin+manager CD, all update, worker sees own) ===\n');
  const path = '/api/orders';
  const body = { customer: customerId, material: materialId, quantity: 5 };

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
    const r6 = await api('PATCH', `${path}/${ordId}`, tokens.worker, { status: 'in_progress' });
    check('PATCH  /orders/:id          (worker — assigned)', r6.status, 200);

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

async function testRequests(tokens, customerId, workerId) {
  console.log('\n=== Requests (all create/update, admin+manager delete, worker sees own) ===\n');
  const path = '/api/requests';
  const body = { details: { type: 'cut', quantity: 5 }, customer: customerId };

  const r1 = await api('POST', path, tokens.admin, { ...body, assignedTo: workerId });
  check('POST   /requests            (admin)', r1.status, 201);
  const reqId = r1.data.data?._id;

  const r2 = await api('POST', path, tokens.manager, body);
  check('POST   /requests            (manager)', r2.status, 201);
  const reqId2 = r2.data.data?._id;

  const r3 = await api('POST', path, tokens.worker, body);
  check('POST   /requests            (worker)', r3.status, 201);
  const reqId3 = r3.data.data?._id;

  const r4 = await api('GET', path, tokens.admin);
  check('GET    /requests            (admin)', r4.status, 200);
  const r5 = await api('GET', path, tokens.worker);
  check('GET    /requests            (worker — own only)', r5.status, 200);
  console.log(`          worker sees ${r5.data.data?.length || 0} request(s), admin sees ${r4.data.data?.length || 0}`);

  if (reqId) {
    const r6 = await api('PATCH', `${path}/${reqId}`, tokens.worker, { deliveryLocation: 'Updated' });
    check('PATCH  /requests/:id        (worker — assigned)', r6.status, 200);

    if (reqId2) {
      const r7 = await api('PATCH', `${path}/${reqId2}`, tokens.worker, { deliveryLocation: 'Hacked' });
      check('PATCH  /requests/:id        (worker — not assigned)', r7.status, 403);
    }
  }

  const r8 = await api('DELETE', `${path}/${reqId}`, tokens.worker);
  check('DELETE /requests/:id        (worker)', r8.status, 403);
  const r9 = await api('DELETE', `${path}/${reqId}`, tokens.manager);
  check('DELETE /requests/:id        (manager)', r9.status, 200);

  if (reqId2) await api('DELETE', `${path}/${reqId2}`, tokens.admin);
  if (reqId3) await api('DELETE', `${path}/${reqId3}`, tokens.admin);
}

async function testWithdrawals(tokens, materialId, workerId) {
  console.log('\n=== Withdrawals (all create, admin+manager update/delete, worker sees own) ===\n');
  const path = '/api/withdrawals';
  const body = { withdrawnBy: workerId, material: materialId, quantity: 2, stockType: 'Raw' };

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
    const r7 = await api('PATCH', `${path}/${wdId}`, tokens.manager, { quantity: 10 });
    check('PATCH  /withdrawals/:id     (manager)', r7.status, 200);

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

async function testMaterialLogs(tokens, materialId) {
  console.log('\n=== Material Logs (admin+manager CUD, admin-only delete) ===\n');
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

    const r7 = await api('DELETE', `${path}/${logId}`, tokens.manager);
    check('DELETE /material-logs/:id   (manager)', r7.status, 403);
    const r8 = await api('DELETE', `${path}/${logId}`, tokens.admin);
    check('DELETE /material-logs/:id   (admin)', r8.status, 200);
  }

  if (logId2) await api('DELETE', `${path}/${logId2}`, tokens.admin);
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

async function main() {
  console.log('=== RBAC Test Suite ===\n');
  console.log('Setting up users...');

  const adminToken = await login('admin', 'admin123');
  await setupUsers(adminToken);

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
  await testWorkers(tokens);

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
  await testOrders(tokens, custId, matId, workerId);
  await testRequests(tokens, custId, workerId);
  await testWithdrawals(tokens, matId, workerId);
  await testClaims(tokens, custId, matId, workerId, adminId);
  await testNotifications(tokens, workerId);

  // Cleanup shared test data
  await api('DELETE', `/api/materials/${matId}`, adminToken);
  await api('DELETE', `/api/customers/${custId}`, adminToken);
  await api('DELETE', `/api/station-templates/${tmplId}`, adminToken);

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
