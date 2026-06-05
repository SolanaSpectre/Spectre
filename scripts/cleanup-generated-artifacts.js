const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ARCHIVE_ROOT = process.env.SPECTRE_ARCHIVE_ROOT || 'C:\\Spectre-archives\\Spectre-clean';
const GB = 1024 ** 3;

function parseArgs(argv) {
  const args = {
    dryRun: true,
    archiveRoot: DEFAULT_ARCHIVE_ROOT,
    minFreeGb: Number(process.env.SPECTRE_MIN_FREE_GB || 8),
    keepTelemetry: Number(process.env.SPECTRE_KEEP_TELEMETRY_LOGS || 8),
    keepDossiers: Number(process.env.SPECTRE_KEEP_CANDIDATE_DOSSIERS || 8),
    keepStrategyLedgers: Number(process.env.SPECTRE_KEEP_STRATEGY_LEDGERS || 8),
    keepReportDays: Number(process.env.SPECTRE_KEEP_REPORT_DAYS || 2),
    rotateOutcomeLedger: process.env.SPECTRE_ROTATE_OUTCOME_LEDGER === 'true'
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--force') args.dryRun = false;
    if (arg === '--dry-run') args.dryRun = true;
    if (arg === '--archive-root' && next) {
      args.archiveRoot = next;
      i += 1;
    }
    if (arg === '--min-free-gb' && next) {
      args.minFreeGb = Number(next);
      i += 1;
    }
    if (arg === '--keep-telemetry' && next) {
      args.keepTelemetry = Number(next);
      i += 1;
    }
    if (arg === '--keep-dossiers' && next) {
      args.keepDossiers = Number(next);
      i += 1;
    }
    if (arg === '--keep-strategy-ledgers' && next) {
      args.keepStrategyLedgers = Number(next);
      i += 1;
    }
    if (arg === '--keep-report-days' && next) {
      args.keepReportDays = Number(next);
      i += 1;
    }
    if (arg === '--rotate-outcome-ledger') args.rotateOutcomeLedger = true;
    if (arg === '--no-rotate-outcome-ledger') args.rotateOutcomeLedger = false;
  }

  return args;
}

function safeNumber(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function statfsFreeBytes(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    return Number(stats.bavail || stats.bfree || 0) * Number(stats.bsize || 0);
  } catch {
    return null;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'n/a';
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  const mb = 1024 ** 2;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  const kb = 1024;
  if (bytes >= kb) return `${(bytes / kb).toFixed(1)} KB`;
  return `${bytes} B`;
}

function isUnder(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertRepoPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!isUnder(REPO_ROOT, resolved)) {
    throw new Error(`Refusing to touch path outside repo: ${resolved}`);
  }
  return resolved;
}

function archivePathFor(filePath, archiveRunRoot) {
  const resolved = assertRepoPath(filePath);
  const relative = path.relative(REPO_ROOT, resolved);
  return path.join(archiveRunRoot, relative);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function listFiles(dirPath) {
  const resolved = path.join(REPO_ROOT, dirPath);
  if (!fs.existsSync(resolved)) return [];

  return fs.readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(resolved, entry.name);
      const stats = fs.statSync(filePath);
      return {
        path: filePath,
        name: entry.name,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      };
    });
}

function listFilesRecursive(dirPath) {
  const resolved = path.join(REPO_ROOT, dirPath);
  if (!fs.existsSync(resolved)) return [];

  const files = [];
  const stack = [resolved];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = fs.statSync(entryPath);
      files.push({
        path: entryPath,
        name: entry.name,
        size: stats.size,
        mtimeMs: stats.mtimeMs
      });
    }
  }
  return files;
}

function newestKeepCandidates(dirPath, regex, keepCount, reason) {
  const files = listFiles(dirPath)
    .filter((file) => regex.test(file.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(Math.max(0, safeNumber(keepCount, 0))).map((file) => ({ ...file, reason }));
}

function staleReportCandidates(keepReportDays) {
  const cutoff = Date.now() - safeNumber(keepReportDays, 2) * 24 * 60 * 60 * 1000;
  return listFilesRecursive(path.join('data', 'reports'))
    .filter((file) => !/-latest\./.test(file.name))
    .filter((file) => file.mtimeMs < cutoff)
    .map((file) => ({ ...file, reason: `non-latest report older than ${keepReportDays}d` }));
}

function staleLaunchIntelCandidates(keepReportDays) {
  const cutoff = Date.now() - safeNumber(keepReportDays, 2) * 24 * 60 * 60 * 1000;
  return listFilesRecursive(path.join('data', 'launch-intel'))
    .filter((file) => file.mtimeMs < cutoff)
    .map((file) => ({ ...file, reason: `launch intel older than ${keepReportDays}d` }));
}

function staleWalletReportCandidates(keepReportDays) {
  const cutoff = Date.now() - safeNumber(keepReportDays, 2) * 24 * 60 * 60 * 1000;
  return listFilesRecursive(path.join('data', 'wallet-reports'))
    .filter((file) => file.mtimeMs < cutoff)
    .map((file) => ({ ...file, reason: `wallet report older than ${keepReportDays}d` }));
}

function outcomeLedgerCandidate(rotateOutcomeLedger) {
  if (!rotateOutcomeLedger) return [];
  const ledgerPath = path.join(REPO_ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) return [];
  const stats = fs.statSync(ledgerPath);
  if (stats.size < GB) return [];
  return [{
    path: ledgerPath,
    name: path.basename(ledgerPath),
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    reason: 'large outcome ledger rotation requested'
  }];
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const resolved = assertRepoPath(candidate.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push({ ...candidate, path: resolved });
  }
  return unique;
}

function moveToArchive(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
  }
}

function cleanup(args) {
  const archiveRunRoot = path.join(
    path.resolve(args.archiveRoot),
    new Date().toISOString().replace(/[:.]/g, '-')
  );
  const beforeFree = statfsFreeBytes(REPO_ROOT);
  const candidates = uniqueCandidates([
    ...newestKeepCandidates('run-logs', /^telemetry-.*\.jsonl$/i, args.keepTelemetry, `older telemetry beyond newest ${args.keepTelemetry}`),
    ...newestKeepCandidates('run-logs', /^candidate-dossiers-.*\.jsonl$/i, args.keepDossiers, `older candidate dossiers beyond newest ${args.keepDossiers}`),
    ...newestKeepCandidates('run-logs', /^strategy-ledger-.*\.jsonl$/i, args.keepStrategyLedgers, `older strategy ledgers beyond newest ${args.keepStrategyLedgers}`),
    ...staleReportCandidates(args.keepReportDays),
    ...staleLaunchIntelCandidates(args.keepReportDays),
    ...staleWalletReportCandidates(args.keepReportDays),
    ...outcomeLedgerCandidate(args.rotateOutcomeLedger)
  ]).sort((a, b) => b.size - a.size);

  let selectedBytes = 0;
  let archivedBytes = 0;
  let archivedFiles = 0;
  const failures = [];

  for (const candidate of candidates) {
    selectedBytes += candidate.size;
    const targetPath = archivePathFor(candidate.path, archiveRunRoot);
    if (args.dryRun) continue;
    try {
      moveToArchive(candidate.path, targetPath);
      archivedBytes += candidate.size;
      archivedFiles += 1;
    } catch (error) {
      failures.push({ file: path.relative(REPO_ROOT, candidate.path), error: error.message });
    }
  }

  const afterFree = statfsFreeBytes(REPO_ROOT);
  const result = {
    dryRun: args.dryRun,
    repoRoot: REPO_ROOT,
    archiveRoot: path.resolve(args.archiveRoot),
    archiveRunRoot,
    minFreeGb: args.minFreeGb,
    beforeFreeBytes: beforeFree,
    afterFreeBytes: afterFree,
    selectedFiles: candidates.length,
    selectedBytes,
    archivedFiles,
    archivedBytes,
    failures,
    enoughFreeSpace: Number.isFinite(afterFree) ? afterFree >= args.minFreeGb * GB : null
  };

  console.log(`[cleanup] mode=${args.dryRun ? 'dry-run' : 'force'} selected=${result.selectedFiles} (${formatBytes(selectedBytes)}) archived=${archivedFiles} (${formatBytes(archivedBytes)})`);
  console.log(`[cleanup] free before=${formatBytes(beforeFree)} after=${formatBytes(afterFree)} min=${args.minFreeGb} GB`);
  if (candidates.length) {
    console.log('[cleanup] largest selected artifacts:');
    for (const candidate of candidates.slice(0, 10)) {
      console.log(`  - ${path.relative(REPO_ROOT, candidate.path)} ${formatBytes(candidate.size)} (${candidate.reason})`);
    }
  }
  if (failures.length) {
    console.warn('[cleanup] failures:');
    for (const failure of failures.slice(0, 10)) {
      console.warn(`  - ${failure.file}: ${failure.error}`);
    }
  }

  return result;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const result = cleanup(args);
  if (result.failures.length > 0) {
    process.exitCode = 1;
  } else if (result.enoughFreeSpace === false) {
    console.warn('[cleanup] warning: free space remains below requested threshold');
  }
}

module.exports = { cleanup, parseArgs, formatBytes, statfsFreeBytes };
