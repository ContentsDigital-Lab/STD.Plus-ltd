/**
 * Shared test cleanup helpers.
 *
 * Every test script takes a snapshot of all resource IDs before running,
 * then sweeps (deletes) anything new in the `finally` block — even if a
 * test threw midway. This guarantees zero leftover data.
 */

const CLEANUP_ENDPOINTS = [
  '/api/notifications',
  '/api/production-logs',
  '/api/material-logs',
  '/api/claims',
  '/api/withdrawals',
  '/api/panes',
  '/api/orders',
  '/api/requests',
  '/api/inventories',
  '/api/stations',
  '/api/station-templates',
  '/api/sticker-templates',
  '/api/job-types',
  '/api/materials',
  '/api/customers',
  '/api/workers',
];

async function _fetch(apiBase, method, path, token, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers.Authorization = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${apiBase}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

async function _getAllIds(apiBase, token, path) {
  const ids = new Set();
  const res = await _fetch(apiBase, 'GET', `${path}?limit=100&page=1`, token);
  const data = res.data?.data;
  if (Array.isArray(data)) for (const d of data) if (d._id) ids.add(d._id);
  const totalPages = res.data?.pagination?.totalPages || 1;
  for (let p = 2; p <= totalPages; p++) {
    const r = await _fetch(apiBase, 'GET', `${path}?limit=100&page=${p}`, token);
    if (Array.isArray(r.data?.data)) for (const d of r.data.data) if (d._id) ids.add(d._id);
  }
  return ids;
}

async function snapshotIds(apiBase, token) {
  console.log('   Taking pre-test snapshot...');
  const snap = {};
  for (const ep of CLEANUP_ENDPOINTS) {
    snap[ep] = await _getAllIds(apiBase, token, ep);
  }
  return snap;
}

async function sweepCreatedData(apiBase, token, snapshot) {
  console.log('\n   Sweeping leftover test data...');
  let swept = 0;
  for (const ep of CLEANUP_ENDPOINTS) {
    try {
      const current = await _getAllIds(apiBase, token, ep);
      const newIds = [...current].filter((id) => !snapshot[ep].has(id));
      for (const id of newIds) {
        const r = await _fetch(apiBase, 'DELETE', `${ep}/${id}`, token).catch(() => ({}));
        if (r?.status === 200) swept++;
      }
    } catch (e) {
      /* ignore sweep errors for this endpoint */
    }
  }
  console.log(`   Sweep complete — removed ${swept} leftover document(s).`);
}

module.exports = { snapshotIds, sweepCreatedData };
