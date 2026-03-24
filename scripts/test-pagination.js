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

async function main() {
  console.log('=== Pagination Test Suite ===\n');

  const token = await login('admin', 'admin123');
  console.log(`   Token: ...${token.slice(-10)}\n`);

  // Create 25 materials for testing
  console.log('--- Setup: creating 25 materials ---\n');
  const materialIds = [];
  for (let i = 1; i <= 25; i++) {
    const r = await api('POST', '/api/materials', token, {
      name: `Pagination Mat ${String(i).padStart(2, '0')}`,
      unit: 'sheet',
      reorderPoint: i,
    });
    materialIds.push(r.data.data._id);
  }
  console.log(`   Created ${materialIds.length} materials\n`);

  // ──────────────────────────────────────────
  // 1. Default pagination
  // ──────────────────────────────────────────
  console.log('=== Default Pagination ===\n');

  const r1 = await api('GET', '/api/materials', token);
  check('default page', r1.data.pagination.page, 1);
  check('default limit', r1.data.pagination.limit, 20);
  check('data length <= limit', r1.data.data.length <= 20, true);
  check('total >= 25', r1.data.pagination.total >= 25, true);
  check('totalPages calculated', r1.data.pagination.totalPages, Math.ceil(r1.data.pagination.total / 20));
  check('data is array', Array.isArray(r1.data.data), true);
  check('success is true', r1.data.success, true);

  // ──────────────────────────────────────────
  // 2. Custom page & limit
  // ──────────────────────────────────────────
  console.log('\n=== Custom Page & Limit ===\n');

  const r2 = await api('GET', '/api/materials?page=1&limit=5', token);
  check('page=1 limit=5 → page', r2.data.pagination.page, 1);
  check('page=1 limit=5 → limit', r2.data.pagination.limit, 5);
  check('page=1 limit=5 → data length', r2.data.data.length, 5);

  const r3 = await api('GET', '/api/materials?page=2&limit=5', token);
  check('page=2 limit=5 → page', r3.data.pagination.page, 2);
  check('page=2 limit=5 → data length', r3.data.data.length, 5);

  // Page 1 and page 2 should have different items
  const page1Ids = r2.data.data.map((m) => m._id);
  const page2Ids = r3.data.data.map((m) => m._id);
  const overlap = page1Ids.filter((id) => page2Ids.includes(id));
  check('page 1 and page 2 have no overlap', overlap.length, 0);

  // ──────────────────────────────────────────
  // 3. Last page (partial results)
  // ──────────────────────────────────────────
  console.log('\n=== Last Page (Partial) ===\n');

  const total = r2.data.pagination.total;
  const lastPage = Math.ceil(total / 10);
  const rLast = await api('GET', `/api/materials?page=${lastPage}&limit=10`, token);
  check('last page number', rLast.data.pagination.page, lastPage);
  const expectedOnLastPage = total - (lastPage - 1) * 10;
  check('last page data length', rLast.data.data.length, expectedOnLastPage);

  // ──────────────────────────────────────────
  // 4. Page beyond total → empty
  // ──────────────────────────────────────────
  console.log('\n=== Beyond Last Page ===\n');

  const rBeyond = await api('GET', '/api/materials?page=9999&limit=10', token);
  check('beyond last page → empty', rBeyond.data.data.length, 0);
  check('beyond last page → still has pagination', rBeyond.data.pagination.page, 9999);

  // ──────────────────────────────────────────
  // 5. Limit clamping
  // ──────────────────────────────────────────
  console.log('\n=== Limit Clamping ===\n');

  const rMax = await api('GET', '/api/materials?limit=500', token);
  check('limit=500 clamped to 100', rMax.data.pagination.limit, 100);

  const rZero = await api('GET', '/api/materials?limit=0', token);
  check('limit=0 defaults to 20', rZero.data.pagination.limit, 20);

  const rNeg = await api('GET', '/api/materials?limit=-5', token);
  check('limit=-5 defaults to 20', rNeg.data.pagination.limit, 20);

  const rBad = await api('GET', '/api/materials?page=abc&limit=xyz', token);
  check('garbage page defaults to 1', rBad.data.pagination.page, 1);
  check('garbage limit defaults to 20', rBad.data.pagination.limit, 20);

  // ──────────────────────────────────────────
  // 6. Sorting
  // ──────────────────────────────────────────
  console.log('\n=== Sorting ===\n');

  const rAsc = await api('GET', '/api/materials?sort=name&limit=5', token);
  const namesAsc = rAsc.data.data.map((m) => m.name);
  const isSortedAsc = namesAsc.every((n, i) => i === 0 || n >= namesAsc[i - 1]);
  check('sort=name → ascending', isSortedAsc, true);

  const rDesc = await api('GET', '/api/materials?sort=-name&limit=5', token);
  const namesDesc = rDesc.data.data.map((m) => m.name);
  const isSortedDesc = namesDesc.every((n, i) => i === 0 || n <= namesDesc[i - 1]);
  check('sort=-name → descending', isSortedDesc, true);

  const rDefault = await api('GET', '/api/materials?limit=5', token);
  const dates = rDefault.data.data.map((m) => new Date(m.createdAt).getTime());
  const isNewestFirst = dates.every((d, i) => i === 0 || d <= dates[i - 1]);
  check('default sort → newest first (-createdAt)', isNewestFirst, true);

  // ──────────────────────────────────────────
  // 7. Other endpoints have pagination too
  // ──────────────────────────────────────────
  console.log('\n=== Other Endpoints ===\n');

  const endpoints = [
    '/api/workers',
    '/api/customers',
    '/api/inventories',
    '/api/orders',
    '/api/requests',
    '/api/withdrawals',
    '/api/claims',
    '/api/station-templates',
    '/api/stations',
    '/api/material-logs',
    '/api/notifications',
    '/api/production-logs',
    '/api/sticker-templates',
  ];

  for (const ep of endpoints) {
    const r = await api('GET', `${ep}?page=1&limit=3`, token);
    const hasPagination = r.data.pagination && typeof r.data.pagination.page === 'number';
    check(`${ep} has pagination`, hasPagination, true);
  }

  // ──────────────────────────────────────────
  // 8. Pane endpoint (custom pagination)
  // ──────────────────────────────────────────
  console.log('\n=== Pane Endpoint (Custom) ===\n');

  // Setup: create customer, material, order, panes
  const cust = await api('POST', '/api/customers', token, { name: 'PaginationCust' });
  const custId = cust.data.data._id;
  const mat1 = await api('POST', '/api/materials', token, { name: 'PaginationMat', unit: 'sheet', reorderPoint: 1 });
  const mat1Id = mat1.data.data._id;
  const ord = await api('POST', '/api/orders', token, { customer: custId, material: mat1Id, quantity: 5 });
  const ordId = ord.data.data._id;

  const paneIds = [];
  for (let i = 0; i < 5; i++) {
    const p = await api('POST', '/api/panes', token, {
      order: ordId,
      routing: ['cutting', 'qc'],
      dimensions: { width: 100 * (i + 1), height: 200, thickness: 5 },
      glassType: 'tempered',
    });
    paneIds.push(p.data.data._id);
  }

  const rPanes = await api('GET', '/api/panes', token);
  check('GET /panes returns array', Array.isArray(rPanes.data.data), true);
  check('GET /panes returns data', rPanes.data.data.length >= 5, true);

  // Limit works
  const rPanesLim = await api('GET', '/api/panes?limit=2', token);
  check('GET /panes?limit=2', rPanesLim.data.data.length <= 2, true);

  // Filter by order
  const rPanesOrd = await api('GET', `/api/panes?order=${ordId}`, token);
  check('GET /panes?order= filter', rPanesOrd.data.data.length, 5);

  // Filter by station
  const rPanesSt = await api('GET', '/api/panes?station=cutting', token);
  check('GET /panes?station=cutting filter', rPanesSt.status, 200);
  const allCutting = rPanesSt.data.data.every((p) => p.currentStation === 'cutting');
  check('  all results at cutting', allCutting, true);

  // Filter by status
  const rPanesStat = await api('GET', '/api/panes?status=pending', token);
  check('GET /panes?status=pending filter', rPanesStat.status, 200);

  // Filter by material
  const rPanesMat = await api('GET', `/api/panes?material=${mat1Id}`, token);
  check('GET /panes?material= filter', rPanesMat.status, 200);

  // ──────────────────────────────────────────
  // 9. Pane Logs endpoint (no pagination metadata, just limit)
  // ──────────────────────────────────────────
  console.log('\n=== Pane Logs Endpoint ===\n');

  const rPaneLogs = await api('GET', '/api/pane-logs', token);
  check('GET /pane-logs returns data', rPaneLogs.status, 200);
  check('  returns array', Array.isArray(rPaneLogs.data.data), true);

  const rPaneLogsLim = await api('GET', '/api/pane-logs?limit=3', token);
  check('GET /pane-logs?limit=3', rPaneLogsLim.status, 200);
  check('  respects limit', rPaneLogsLim.data.data.length <= 3, true);

  // ──────────────────────────────────────────
  // Cleanup
  // ──────────────────────────────────────────
  console.log('\n--- Cleanup ---\n');
  await api('DELETE', '/api/panes', token, { ids: paneIds });
  await api('DELETE', `/api/orders/${ordId}`, token);
  await api('DELETE', `/api/customers/${custId}`, token);
  await api('DELETE', `/api/materials/${mat1Id}`, token);

  console.log('--- Cleanup: deleting 25 materials ---\n');
  await api('DELETE', '/api/materials', token, { ids: materialIds });
  console.log('   Done\n');

  console.log('========================================');
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
