// Startup wrapper: load production data then start server
const { execSync } = require('child_process');
const path = require('path');

try {
  console.log('[start] Running production data load...');
  execSync('node ' + path.join(__dirname, 'scripts', 'load-production-data.js'), {
    stdio: 'inherit',
    cwd: __dirname
  });
  console.log('[start] Load complete, starting server...');
} catch (err) {
  console.error('[start] Load script failed:', err.message);
  console.error('[start] Starting server anyway...');
}

require('./server/index.js');
