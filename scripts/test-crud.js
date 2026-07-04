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
    console.log(`   PASS  ${label}`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    failed++;
  }
}

async function testCrud(entityName, endpoint, token, createPayload, updatePayload) {
  console.log(`\n=== Testing CRUD for ${entityName} ===\n`);

  // 1. Create
  const createRes = await api('POST', endpoint, token, createPayload);
  check(`${entityName} Create (201 or 200)`, [201, 200].includes(createRes.status), true);
  if (!createRes.data.success) {
    console.error(`Creation failed:`, createRes.data);
    return null;
  }
  const id = createRes.data.data._id;
  check(`${entityName} Created has _id`, !!id, true);

  // 2. Read All
  const readAllRes = await api('GET', endpoint, token);
  check(`${entityName} Read All (200)`, readAllRes.status, 200);
  const foundInAll = readAllRes.data.data.some(d => d._id === id);
  check(`${entityName} exists in Read All`, foundInAll, true);

  // 3. Read One
  const readOneRes = await api('GET', `${endpoint}/${id}`, token);
  check(`${entityName} Read One (200)`, readOneRes.status, 200);
  check(`${entityName} Read One matches ID`, readOneRes.data.data._id, id);

  // 4. Update
  const updateRes = await api('PATCH', `${endpoint}/${id}`, token, updatePayload);
  check(`${entityName} Update (200)`, updateRes.status, 200);
  
  // Verify Update
  const verifyRes = await api('GET', `${endpoint}/${id}`, token);
  for (const verifyKey of Object.keys(updatePayload)) {
    check(`${entityName} Update Verified (${verifyKey})`, verifyRes.data.data[verifyKey], updatePayload[verifyKey]);
  }

  return id;
}

async function run() {
  console.log('=== CRUD Test Suite ===\n');
  let token;
  try {
    token = await login('admin', 'admin123');
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  const snap = await snapshotIds(API, token);

  try {
    // Role
    await testCrud('Role', '/api/roles', token, 
      { name: 'Test CRUD Role', permissions: ['orders:view'] },
      { name: 'Updated CRUD Role' }
    );

    // Customer
    const custId = await testCrud('Customer', '/api/customers', token,
      { name: 'Test CRUD Customer', address: '123 Main St' },
      { name: 'Updated CRUD Customer' }
    );

    // Material
    const matId = await testCrud('Material', '/api/materials', token,
      { name: 'Test CRUD Material', code: 'MAT-001', brand: 'BrandX', specDetails: { color: 'Clear', thickness: '5mm', glassType: 'Glass', sqft: '10.5' }, unit: 'sqm', reorderPoint: 10 },
      { code: 'MAT-002', isActive: false }
    );

    // Job Type
    await testCrud('Job Type', '/api/job-types', token,
      { name: 'Test CRUD Job Type', code: 'TESTJT', description: 'Test desc' },
      { description: 'Updated desc' }
    );

    // Station Template
    await testCrud('Station Template', '/api/station-templates', token,
      { name: 'Test CRUD Station Tmpl', type: 'cutting', allowSkip: false },
      { name: 'Updated Station Tmpl' }
    );

    // Sticker Template
    await testCrud('Sticker Template', '/api/sticker-templates', token,
      { name: 'Test CRUD Sticker Tmpl', width: 50, height: 30, fields: [{ fieldType: 'paneNumber', x: 0, y: 0 }] },
      { name: 'Updated Sticker Tmpl' }
    );

    // Worker
    await testCrud('Worker', '/api/workers', token,
      { name: 'Test CRUD Worker', username: 'crudworker', password: 'password', position: 'Operator', notificationPreferences: { inApp: true, line: false } },
      { position: 'Manager' }
    );

    // Inventory
    const invId = await testCrud('Inventory', '/api/inventories', token,
      { material: matId, stockType: 'Raw', quantity: 100, location: 'A1' },
      { location: 'B2', isActive: false }
    );

    // Verify auto-increment inventoryNumber
    const invRes = await api('GET', `/api/inventories/${invId}`, token);
    const inventoryNumber = invRes.data?.data?.inventoryNumber;
    check('Inventory auto-increment inventoryNumber exists and starts with INV', inventoryNumber?.startsWith('INV'), true);

    // Request
    const reqId = await testCrud('Request', '/api/requests', token,
      { customer: custId, details: { type: 'Custom Request', quantity: 10 }, referenceId: 'PO-12345' },
      { status: 'cancelled', cancelReason: 'Customer changed mind', referenceId: 'PO-67890' }
    );

    // Verify Request auto-increment requestNumber
    const reqRes = await api('GET', `/api/requests/${reqId}`, token);
    const requestNumber = reqRes.data?.data?.requestNumber;
    check('Request auto-increment requestNumber exists and starts with REQ', requestNumber?.startsWith('REQ'), true);

    // Request deadlineChangeReason test
    console.log(`\n=== Testing Request deadlineChangeReason ===\n`);
    const initialDeadline = new Date(Date.now() + 86400000).toISOString();
    const updatedDeadline = new Date(Date.now() + 172800000).toISOString();
    
    const dcrReqRes = await api('POST', '/api/requests', token, { customer: custId, details: { type: 'DCR Test', quantity: 1 }, deadline: initialDeadline });
    const dcrReqId = dcrReqRes.data.data._id;
    
    // 1. Try to update deadline without reason (should fail)
    const failUpdate = await api('PATCH', `/api/requests/${dcrReqId}`, token, { deadline: updatedDeadline });
    check('Request Update Deadline without reason fails (400)', failUpdate.status, 400);

    // 2. Try to update deadline with reason (should succeed)
    const successUpdate = await api('PATCH', `/api/requests/${dcrReqId}`, token, { deadline: updatedDeadline, deadlineChangeReason: 'Customer requested delay' });
    check('Request Update Deadline with reason succeeds (200)', successUpdate.status, 200);

    // 3. Try to update other fields without changing deadline, without reason (should succeed)
    // Send the same deadline so `oldDeadline === newDeadline` in the controller logic
    const sameDeadlineUpdate = await api('PATCH', `/api/requests/${dcrReqId}`, token, { deadline: updatedDeadline, expectedDeliveryDate: new Date(Date.now() + 200000000).toISOString() });
    check('Request Update unchanged deadline without reason succeeds (200)', sameDeadlineUpdate.status, 200);

    // 4. Try to update other fields (no deadline in body), without reason (should succeed)
    const noDeadlineUpdate = await api('PATCH', `/api/requests/${dcrReqId}`, token, { expectedDeliveryDate: new Date(Date.now() + 300000000).toISOString() });
    check('Request Update no deadline in body without reason succeeds (200)', noDeadlineUpdate.status, 200);


  } finally {
    await sweepCreatedData(API, token, snap);
  }

  console.log(`\n========================================`);
  console.log(`   PASSED: ${passed}`);
  console.log(`   FAILED: ${failed}`);
  console.log(`   TOTAL:  ${passed + failed}`);
  console.log(`========================================\n`);

  if (failed > 0) process.exit(1);
}

run();