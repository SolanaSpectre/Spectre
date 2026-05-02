require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { spawn } = require('child_process');
const path = require('path');
const { POST_RUN_REPORTS } = require('./post-run-report-plan');

const REPO_ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

function runReport({ title, script }) {
  return new Promise((resolve) => {
    console.log(`\n=== ${title} ===`);
    const child = spawn(NODE, [path.join('scripts', script)], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false
    });

    child.on('error', (error) => {
      console.warn(`[WARN] ${title} failed to start: ${error.message}`);
      resolve(1);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`[WARN] ${title} exited with code ${code}; continuing.`);
      }
      resolve(code || 0);
    });
  });
}

async function main() {
  let failures = 0;
  for (const report of POST_RUN_REPORTS) {
    const code = await runReport(report);
    if (code !== 0) failures += 1;
  }

  if (failures > 0) {
    console.warn(`Post-run reports completed with ${failures} warning(s).`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
