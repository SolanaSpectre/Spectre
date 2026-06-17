#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CHECK_DIRS = ['src', 'scripts'];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name === 'node_modules') continue;
      out.push(...walk(full));
    } else if (item.isFile() && item.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  return {
    filePath,
    ok: result.status === 0,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim()
  };
}

function main() {
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const files = CHECK_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
  const results = files.map(runNodeCheck);
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    for (const failure of failures.slice(0, 20)) {
      console.error(`[smoke] ${path.relative(ROOT, failure.filePath)} failed syntax check`);
      if (failure.output) console.error(failure.output);
    }
    if (failures.length > 20) console.error(`[smoke] ${failures.length - 20} more failure(s) omitted`);
    process.exit(1);
  }
  console.log(`[smoke] checked ${files.length} JavaScript files`);
}

if (require.main === module) main();
