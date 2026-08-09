#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSourceFingerprint } = require('../src/lib/runtime-source-provenance');
const priorPrereg = require('../data/strategy-preregistrations/runner-watch-full-coverage-v7.json');
const prereg = require('../data/strategy-preregistrations/runner-watch-full-coverage-v8.json');

const ROOT = path.join(__dirname, '..');
assert.strictEqual(priorPrereg.terminalDisposition.closedToFurtherLedgerAppends, true);
const actual = buildSourceFingerprint(ROOT, prereg.sourceFreeze.files);
assert.strictEqual(actual.algorithm, prereg.sourceFreeze.algorithm);
assert.strictEqual(actual.sourceFingerprint, prereg.sourceFreeze.expectedSourceFingerprint);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectre-source-provenance-'));
try {
  fs.writeFileSync(path.join(tempDir, 'fixture.js'), 'one\r\ntwo\r\n', 'utf8');
  const crlf = buildSourceFingerprint(tempDir, ['fixture.js']);
  fs.writeFileSync(path.join(tempDir, 'fixture.js'), 'one\ntwo\n', 'utf8');
  const lf = buildSourceFingerprint(tempDir, ['fixture.js']);
  assert.strictEqual(crlf.sourceFingerprint, lf.sourceFingerprint, 'line endings must not change provenance');

  fs.writeFileSync(path.join(tempDir, 'fixture.js'), 'one\nchanged\n', 'utf8');
  const changed = buildSourceFingerprint(tempDir, ['fixture.js']);
  assert.notStrictEqual(changed.sourceFingerprint, lf.sourceFingerprint, 'source changes must change provenance');
  assert.throws(() => buildSourceFingerprint(tempDir, ['../outside.js']), /escapes repository root/);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('Runtime source provenance smoke passed');
