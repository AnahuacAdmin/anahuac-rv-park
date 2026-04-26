// Startup wrapper: load production data then start server
const { execSync } = require('child_process');
const path = require('path');

try {
  console.log('[start] Running lot type fix script...');
  execSync('node ' + path.join(__dirname, 'scripts', 'fix-lot-types.js'), {
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('[start] Fix complete, starting server...');
} catch (err) {
  console.error('[start] Fix script failed:', err.message);
  console.error('[start] Starting server anyway...');
}

require('./server/index.js');
