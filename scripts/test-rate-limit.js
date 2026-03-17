require('dotenv').config();
const API = `http://localhost:${process.env.PORT || 3000}`;

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`   PASS  ${label} — ${actual}`);
    passed++;
  } else {
    console.log(`   FAIL  ${label} — got ${actual}, expected ${expected}`);
    failed++;
  }
}

async function login(username, password) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!data.data?.token) {
    throw new Error(`Login failed for "${username}" (${res.status}): ${data.message}`);
  }
  return data.data.token;
}

async function blast(method, path, token, count) {
  const results = { ok: 0, limited: 0, other: 0 };
  for (let i = 0; i < count; i++) {
    const opts = { method, headers: {} };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, opts);
    if (res.status === 429) results.limited++;
    else if (res.status >= 200 && res.status < 300) results.ok++;
    else results.other++;
  }
  return results;
}

async function testPublicRateLimit() {
  console.log('\n=== Public Rate Limit (IP-based) ===\n');

  const limit = parseInt(process.env.RATE_LIMIT_MAX) || 100;
  const total = limit + 20;
  console.log(`   Sending ${total} requests to GET /api/health (limit: ${limit})...\n`);

  const results = await blast('GET', '/api/health', null, total);

  console.log(`   Successful: ${results.ok}`);
  console.log(`   Rate limited (429): ${results.limited}`);
  console.log(`   Other: ${results.other}\n`);

  check('some requests succeeded', results.ok > 0, true);
  check('some requests were rate limited', results.limited > 0, true);
  check('rate limit kicked in around the limit', results.ok <= limit + 5, true);
}

async function waitForWindowReset() {
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000;
  const banMs = parseInt(process.env.RATE_LIMIT_BAN_MS) || 10000;
  const waitMs = Math.max(windowMs, banMs) + 1000;
  console.log(`\n   Waiting ${waitMs / 1000}s for rate limit window + ban to reset...\n`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function testAuthRateLimit() {
  console.log('\n=== Authenticated Rate Limit (User-based) ===\n');

  const limit = parseInt(process.env.RATE_LIMIT_AUTH_MAX) || 1000;

  const token1 = await login('admin', 'admin123');
  console.log(`   Admin token: ...${token1.slice(-10)}`);

  let token2;
  try {
    token2 = await login('manager1', 'manager123');
    console.log(`   Manager token: ...${token2.slice(-10)}`);
  } catch {
    console.log('   Skipping two-user test (manager1 not found — run test:rbac first to create it)\n');
    token2 = null;
  }

  const total = limit + 20;
  console.log(`\n   Sending ${total} requests as admin to GET /api/workers (limit: ${limit})...\n`);

  const results1 = await blast('GET', '/api/workers', token1, total);

  console.log(`   Admin — Successful: ${results1.ok}`);
  console.log(`   Admin — Rate limited (429): ${results1.limited}`);
  console.log(`   Admin — Other: ${results1.other}\n`);

  check('admin: some requests succeeded', results1.ok > 0, true);
  check('admin: some requests were rate limited', results1.limited > 0, true);
  check('admin: rate limit kicked in around the limit', results1.ok <= limit + 5, true);

  if (token2) {
    console.log(`\n   Sending 10 requests as manager (should NOT be rate limited)...\n`);

    const results2 = await blast('GET', '/api/workers', token2, 10);

    console.log(`   Manager — Successful: ${results2.ok}`);
    console.log(`   Manager — Rate limited (429): ${results2.limited}\n`);

    check('manager: not affected by admin rate limit', results2.limited, 0);
    check('manager: all requests succeeded', results2.ok, 10);
  }
}

async function main() {
  console.log('=== Rate Limit Test Suite ===');

  await testPublicRateLimit();
  await waitForWindowReset();
  await testAuthRateLimit();

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
