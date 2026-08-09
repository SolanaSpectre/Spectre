'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalSourceText(buffer) {
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function resolveSourceFile(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (!normalized || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Source provenance path escapes repository root: ${relativePath}`);
  }
  return { normalized, resolved };
}

function buildSourceFingerprint(rootDir, sourceFiles = []) {
  const files = [...new Set(sourceFiles.map(normalizeRelativePath))].sort();
  if (!files.length) {
    throw new Error('Source provenance requires at least one source file');
  }

  const fileDigests = files.map((relativePath) => {
    const { normalized, resolved } = resolveSourceFile(rootDir, relativePath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`Source provenance file is missing: ${normalized}`);
    }
    const canonicalText = canonicalSourceText(fs.readFileSync(resolved));
    return {
      path: normalized,
      sha256: sha256(canonicalText),
      canonicalBytes: Buffer.byteLength(canonicalText, 'utf8')
    };
  });

  const aggregateInput = JSON.stringify(fileDigests.map((row) => ({
    path: row.path,
    sha256: row.sha256
  })));

  return {
    schemaVersion: 1,
    algorithm: 'sha256_canonical_lf_v1',
    sourceFingerprint: sha256(aggregateInput),
    files: fileDigests
  };
}

function runGit(rootDir, args) {
  const result = spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function readGitSourceState(rootDir) {
  const commit = runGit(rootDir, ['rev-parse', 'HEAD']);
  const status = runGit(rootDir, ['status', '--porcelain', '--untracked-files=all']);
  return {
    available: Boolean(commit && status !== null),
    commit: commit || null,
    workingTreeDirty: status === null ? null : status.length > 0
  };
}

function buildRuntimeSourceProvenance(rootDir, sourceFiles = []) {
  return {
    ...buildSourceFingerprint(rootDir, sourceFiles),
    git: readGitSourceState(rootDir)
  };
}

module.exports = {
  buildRuntimeSourceProvenance,
  buildSourceFingerprint,
  canonicalSourceText,
  readGitSourceState
};
