const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_QUEUE_PATH = path.join(
  REPO_ROOT,
  'agents',
  'weRvENum',
  'runtime',
  'token_social_research_queue.json'
);

const DEFAULT_INPUTS = {
  battlefield: path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json'),
  continuationSpecimens: path.join(REPO_ROOT, 'data', 'reports', 'continuation-specimens-latest.json'),
  learning: path.join(REPO_ROOT, 'data', 'reports', 'learning-orchestrator-latest.json')
};

const SOLANA_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (/^\d+$/.test(arg) && args.limit === undefined) {
      args.limit = arg;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function repoPath(filePath, fallback) {
  const target = filePath || fallback;
  return path.isAbsolute(target) ? target : path.join(REPO_ROOT, target);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function cleanTicker(value) {
  const ticker = String(value || '')
    .replace(/^\$/, '')
    .replace(/^\//, '')
    .trim();
  return ticker || null;
}

function cleanName(value) {
  const name = String(value || '').trim();
  return name || null;
}

function validMint(value) {
  const mint = String(value || '').trim();
  return SOLANA_MINT_RE.test(mint) ? mint : null;
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeDedupeKey(candidate) {
  return [
    String(candidate.mint || '').toLowerCase(),
    String(candidate.ticker || '').toLowerCase(),
    String(candidate.name || '').toLowerCase()
  ].join('|');
}

function makeItemId(candidate, createdAt) {
  const safeTicker = String(candidate.ticker || 'TOKEN').replace(/[^A-Za-z0-9]+/g, '').slice(0, 16) || 'TOKEN';
  const digest = crypto
    .createHash('sha1')
    .update(`${candidate.mint}|${candidate.ticker || ''}|${candidate.name || ''}|${createdAt}`)
    .digest('hex')
    .slice(0, 10);
  return `${safeTicker}-${digest}`;
}

function reasonFromParts(parts) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join('; ');
}

function addCandidate(candidates, candidate) {
  const mint = validMint(candidate.mint);
  if (!mint) return;

  const normalized = {
    ...candidate,
    mint,
    ticker: cleanTicker(candidate.ticker || candidate.symbol),
    name: cleanName(candidate.name),
    score: numberOrZero(candidate.score),
    source: candidate.source || 'spectre_report'
  };

  const key = makeDedupeKey(normalized);
  const existing = candidates.get(key);
  if (!existing || normalized.score > existing.score) {
    candidates.set(key, normalized);
  }
}

function collectContinuationSpecimens(payload, candidates, minScore) {
  for (const specimen of payload?.specimens || []) {
    const score = numberOrZero(specimen.continuationScore);
    const rickMentions = numberOrZero(specimen.rickOverlap?.mentions);
    const volume1hUsd = numberOrZero(specimen.volume1hUsd);
    const liquidityUsd = numberOrZero(specimen.liquidityUsd);
    const riskFlags = Array.isArray(specimen.riskFlags) ? specimen.riskFlags : [];
    const interesting = score >= minScore || (rickMentions >= 2 && volume1hUsd > 0);

    if (!interesting) continue;

    const riskText = riskFlags.length ? `risks ${riskFlags.join(',')}` : 'no major specimen risk flags';
    const reason = reasonFromParts([
      `continuation specimen ${specimen.label || 'candidate'}`,
      `score ${score.toFixed(2)}`,
      rickMentions ? `Rick mentions ${rickMentions}` : null,
      volume1hUsd ? `1h volume $${Math.round(volume1hUsd)}` : null,
      liquidityUsd ? `liquidity $${Math.round(liquidityUsd)}` : null,
      riskText
    ]);

    addCandidate(candidates, {
      mint: specimen.mint,
      ticker: specimen.symbol,
      name: specimen.name,
      score: clamp(score + (rickMentions * 4) + Math.log10(volume1hUsd + 1), 1, 100),
      priority: clamp(Math.round(45 + score + (rickMentions * 5)), 10, 95),
      source: 'spectre_continuation_specimens',
      reason
    });
  }
}

function collectBattlefield(payload, candidates, minScore) {
  for (const laneItem of [
    ...(payload?.runnerLane?.generated || []),
    ...(payload?.runnerLane?.executed || [])
  ]) {
    const score = numberOrZero(laneItem.score || laneItem.qualityScore || laneItem.aiScore);
    if (score && score < minScore) continue;

    addCandidate(candidates, {
      mint: laneItem.mint,
      ticker: laneItem.symbol || laneItem.ticker,
      name: laneItem.name,
      score: score || 50,
      priority: clamp(Math.round(65 + score / 2), 30, 95),
      source: 'spectre_runner_lane',
      reason: reasonFromParts([
        'runner lane generated token candidate',
        laneItem.profile || laneItem.paperProfile || null,
        score ? `score ${score.toFixed(2)}` : null
      ])
    });
  }

  for (const nearMiss of payload?.preMigrationPaper?.firstCurveSnapshotNearMissDetail || []) {
    const score = numberOrZero(nearMiss.score || nearMiss.qualityScore);
    if (score < minScore) continue;

    addCandidate(candidates, {
      mint: nearMiss.mint,
      ticker: nearMiss.symbol || nearMiss.ticker,
      name: nearMiss.name,
      score,
      priority: clamp(Math.round(50 + score), 30, 90),
      source: 'spectre_pre_migration_near_miss',
      reason: reasonFromParts([
        'near-miss first-curve scalp candidate',
        score ? `score ${score.toFixed(2)}` : null,
        nearMiss.failedCheck || nearMiss.reason || null
      ])
    });
  }
}

function collectLearningTopWatch(payload, candidates, minScore) {
  for (const lesson of payload?.lessons || []) {
    for (const watch of lesson?.evidence?.topWatch || []) {
      const score = numberOrZero(watch.score);
      if (score < minScore) continue;

      addCandidate(candidates, {
        mint: watch.mint,
        ticker: watch.symbol,
        name: watch.name,
        score,
        priority: clamp(Math.round(45 + score), 30, 85),
        source: 'spectre_learning_top_watch',
        reason: reasonFromParts([
          'learning report top watch candidate',
          watch.verdict ? `verdict ${watch.verdict}` : null,
          `score ${score.toFixed(2)}`,
          watch.curveProgress !== undefined ? `curve ${watch.curveProgress}` : null
        ])
      });
    }
  }
}

function loadQueue(queuePath) {
  if (!fs.existsSync(queuePath)) {
    const now = new Date().toISOString();
    return {
      source: 'venum_token_social_research_queue',
      created_at: now,
      updated_at: now,
      items: []
    };
  }
  const queue = readJsonIfExists(queuePath);
  queue.items = Array.isArray(queue.items) ? queue.items : [];
  return queue;
}

function removeLocalSmokeItems(queue) {
  const before = queue.items.length;
  queue.items = queue.items.filter((item) => {
    return !(item.source === 'test' && item.reason === 'queue smoke');
  });
  return before - queue.items.length;
}

function enqueueCandidates(queue, candidates, limit) {
  const now = new Date().toISOString();
  const existingActiveKeys = new Set(
    queue.items
      .filter((item) => ['pending', 'processing'].includes(String(item.status || '').toLowerCase()))
      .map((item) => item.dedupe_key)
      .filter(Boolean)
  );

  const selected = [...candidates.values()]
    .sort((a, b) => numberOrZero(b.priority) - numberOrZero(a.priority) || numberOrZero(b.score) - numberOrZero(a.score))
    .slice(0, limit);

  const enqueued = [];
  const skipped = [];

  for (const candidate of selected) {
    const dedupeKey = makeDedupeKey(candidate);
    if (existingActiveKeys.has(dedupeKey)) {
      skipped.push({ mint: candidate.mint, ticker: candidate.ticker, reason: 'already_pending' });
      continue;
    }

    const item = {
      id: makeItemId(candidate, now),
      dedupe_key: dedupeKey,
      status: 'pending',
      priority: numberOrZero(candidate.priority) || 50,
      source: candidate.source,
      reason: candidate.reason,
      created_at: now,
      updated_at: now,
      mint: candidate.mint,
      ticker: candidate.ticker,
      name: candidate.name,
      attempts: 0,
      last_error: null,
      last_report_path: null,
      last_social_score: null,
      last_status: null
    };

    queue.items.push(item);
    existingActiveKeys.add(dedupeKey);
    enqueued.push(item);
  }

  queue.updated_at = now;
  return { selected, enqueued, skipped };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const minScore = Number(args['min-score'] || 25);
  const limit = Math.max(parseInt(args.limit || '8', 10), 1);
  const queuePath = repoPath(args.queue, DEFAULT_QUEUE_PATH);
  const candidates = new Map();

  collectContinuationSpecimens(
    readJsonIfExists(repoPath(args['continuation-specimens'], DEFAULT_INPUTS.continuationSpecimens)),
    candidates,
    minScore
  );
  collectBattlefield(readJsonIfExists(repoPath(args.battlefield, DEFAULT_INPUTS.battlefield)), candidates, minScore);
  collectLearningTopWatch(readJsonIfExists(repoPath(args.learning, DEFAULT_INPUTS.learning)), candidates, minScore);

  const queue = loadQueue(queuePath);
  const removedSmokeItems = removeLocalSmokeItems(queue);
  const result = enqueueCandidates(queue, candidates, limit);

  if (!args['dry-run']) {
    writeJson(queuePath, queue);
  }

  const summary = {
    dryRun: Boolean(args['dry-run']),
    queuePath,
    minScore,
    candidatesFound: candidates.size,
    selected: result.selected.length,
    enqueued: result.enqueued.length,
    skipped: result.skipped.length,
    removedSmokeItems,
    enqueuedItems: result.enqueued.map((item) => ({
      mint: item.mint,
      ticker: item.ticker,
      name: item.name,
      priority: item.priority,
      source: item.source,
      reason: item.reason
    })),
    skippedItems: result.skipped
  };

  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`Failed to enqueue Venum token research: ${error.message}`);
  process.exit(1);
}
