// POST-DEPLOY SMOKE TEST
// Runs automatically after server starts to verify critical endpoints.
// Usage: called from server/index.js after listen(), or manually: node scripts/post-deploy-test.js

const BASE = process.env.APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3000}`;

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
  await test('Portal login endpoint', `${BASE}/api/portal/login`, (res) => {
    // POST required, so GET should return 404 (route not found for GET) or 400/405, NOT 500
    return res.status !== 500;
  });

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
