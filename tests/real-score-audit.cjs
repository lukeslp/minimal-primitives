/* Build this checkout, then audit MINIMAL_ROOT (or this checkout). Luke Steuber. */
'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ownRoot = path.resolve(__dirname, '..');
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };
function run(command, args) {
  const result = spawnSync(command, args, { cwd: ownRoot, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error.message);
  return result.status === 0 && !result.error;
}
if (!run('python3', ['tools/build.py'])) process.exitCode = 1;
else {
  const api = run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_real_scores.py', '-v']);
  const browser = run('node', ['tests/real-score-browser.cjs']);
  if (!api || !browser) process.exitCode = 1;
}
