// POST-DEPLOY SMOKE TEST
// Runs automatically after server starts to verify critical endpoints.
// Usage: called from server/index.js after listen(), or manually: node scripts/post-deploy-test.js

// Use 127.0.0.1 (not localhost) to avoid IPv6 resolution issues in Railway containers.
// localhost may resolve to ::1 while server binds on 0.0.0.0 (IPv4 only).
const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;

async function runTests() {
  const results = [];

  async function test(name, url, check) {
    try {
      const res = await fetch(url);
      const body = await res.text();
      const passed = check(res, body);
      results.push({ name, passed, status: res.status });
      console.log(`[deploy-test] ${passed ? '✓' : '✗'} ${name} (HTTP ${res.status})`);
    } catch (err) {
      results.push({ name, passed: false, error: err.message });
      console.error(`[deploy-test] ✗ ${name} — ${err.message}`);
    }
  }

  // 1. Health check
  await test('Health endpoint', `${BASE}/api/health`, (res, body) => {
    return res.status === 200 && body.includes('"ok"');
  });

  // 2. Portal login endpoint responds (not 500)
  try {
    const loginRes = await fetch(`${BASE}/api/portal/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lot_id: '__test__', last_name: '__test__' }),
    });
    const passed = loginRes.status === 401 || loginRes.status === 400 || loginRes.status === 429;
    results.push({ name: 'Portal login endpoint', passed, status: loginRes.status });
    console.log(`[deploy-test] ${passed ? '✓' : '✗'} Portal login endpoint (HTTP ${loginRes.status})`);
  } catch (err) {
    results.push({ name: 'Portal login endpoint', passed: false, error: err.message });
    console.error(`[deploy-test] ✗ Portal login endpoint — ${err.message}`);
  }

  // 3. Dashboard loads (requires auth so expect 401, NOT 500)
  await test('Dashboard API responds', `${BASE}/api/dashboard`, (res) => {
    return res.status === 401 || res.status === 200;
  });

  // 4. Static files served
  await test('Portal HTML loads', `${BASE}/portal.html`, (res, body) => {
    return res.status === 200 && body.includes('Anahuac');
  });

  // Summary
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  if (passed === total) {
    console.log(`[deploy-test] All ${total} checks passed ✓`);
  } else {
    console.error(`[CRITICAL] ${total - passed}/${total} deploy checks FAILED`);
  }

  return results;
}

// If run directly (node scripts/post-deploy-test.js), execute immediately
if (require.main === module) {
  // Wait a moment for server to be ready if running right after start
  setTimeout(() => runTests().then(() => process.exit(0)).catch(() => process.exit(1)), 2000);
}

module.exports = { runTests };
