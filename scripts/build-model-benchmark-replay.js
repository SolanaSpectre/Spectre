const fs = require('fs');
const path = require('path');
const readline = require('readline');

const RUN_LOGS_DIR = path.join(__dirname, '..', 'run-logs');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'model-benchmark');

const IGNORED_REJECTION_REASONS = new Set([
  'RUNNER_MODE_REQUIRES_PUMP_MOMENTUM',
  'ENTRY_CAPACITY_FULL',
  'ENTRY_WARMUP',
  'SESSION_NOT_ACTIVE',
  'MAX_OPEN_PAPER_POSITIONS'
]);

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      parsed._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = 'true';
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, value));
}

function getLogPairs() {
  if (!fs.existsSync(RUN_LOGS_DIR)) {
    return [];
  }

  const files = fs.readdirSync(RUN_LOGS_DIR);
  const telemetryByStamp = new Map();
  const ledgerByStamp = new Map();

  for (const fileName of files) {
    const telemetryMatch = fileName.match(/^telemetry-(.+)\.jsonl$/i);
    if (telemetryMatch) {
      telemetryByStamp.set(telemetryMatch[1], path.join(RUN_LOGS_DIR, fileName));
      continue;
    }

    const ledgerMatch = fileName.match(/^strategy-ledger-(.+)\.jsonl$/i);
    if (ledgerMatch) {
      ledgerByStamp.set(ledgerMatch[1], path.join(RUN_LOGS_DIR, fileName));
    }
  }

  return Array.from(new Set([
    ...telemetryByStamp.keys(),
    ...ledgerByStamp.keys()
  ]))
    .map((stamp) => ({
      stamp,
      telemetryPath: telemetryByStamp.get(stamp) || null,
      ledgerPath: ledgerByStamp.get(stamp) || null
    }))
    .filter((item) => item.telemetryPath || item.ledgerPath)
    .sort((a, b) => a.stamp.localeCompare(b.stamp));
}

async function forEachJsonl(filePath, onRow) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      onRow(JSON.parse(trimmed));
    } catch {
      // A malformed telemetry line should not invalidate the remaining replay seed.
    }
  }
}

function ensureTokenBucket(map, token) {
  if (!map.has(token)) {
    map.set(token, {
      token,
      signal: null,
      tradeExecuted: null,
      paperClosed: null,
      aiCaution: null,
      aiVeto: null,
      rejectionReasons: new Map(),
      pumpFailureReasons: new Map(),
      firstSeenAt: null,
      lastSeenAt: null
    });
  }

  return map.get(token);
}

function incrementReasonMap(map, reason, payload = {}) {
  const key = String(reason || 'UNKNOWN');
  const existing = map.get(key) || {
    reason: key,
    count: 0
  };

  existing.count += 1;

  if (payload.momentumScore !== undefined && existing.momentumScore === undefined) {
    existing.momentumScore = payload.momentumScore;
  }

  if (payload.priceImpactPct !== undefined && existing.priceImpactPct === undefined) {
    existing.priceImpactPct = payload.priceImpactPct;
  }

  map.set(key, existing);
}

async function hydrateTelemetryBuckets(filePath) {
  const tokens = new Map();

  await forEachJsonl(filePath, (event) => {
    const type = event.type;
    const payload = event.payload || {};
    const token = payload.token || payload.mint;
    if (!token) {
      return;
    }

    const bucket = ensureTokenBucket(tokens, token);
    const timestamp = event.timestamp || null;

    if (!bucket.firstSeenAt || (timestamp && timestamp < bucket.firstSeenAt)) {
      bucket.firstSeenAt = timestamp;
    }
    if (!bucket.lastSeenAt || (timestamp && timestamp > bucket.lastSeenAt)) {
      bucket.lastSeenAt = timestamp;
    }

    if (type === 'signal.generated' && !bucket.signal) {
      bucket.signal = payload;
      return;
    }

    if (type === 'trade.executed' && !bucket.tradeExecuted) {
      bucket.tradeExecuted = payload;
      return;
    }

    if (type === 'paper.position.closed' && !bucket.paperClosed) {
      bucket.paperClosed = payload;
      return;
    }

    if (type === 'ai.caution' && !bucket.aiCaution) {
      bucket.aiCaution = payload;
      return;
    }

    if (type === 'ai.veto' && !bucket.aiVeto) {
      bucket.aiVeto = payload;
      return;
    }

    if (type === 'trade.rejected') {
      incrementReasonMap(bucket.rejectionReasons, payload.reason, payload);
      return;
    }

    if (type === 'pump.momentum_gate_failed') {
      incrementReasonMap(bucket.pumpFailureReasons, payload.reason, payload);
    }
  });

  return tokens;
}

async function buildLedgerMaps(filePath) {
  const entries = new Map();
  const exits = new Map();

  await forEachJsonl(filePath, (event) => {
    const type = event.type;
    const payload = event.payload || {};
    const token = payload.token;
    if (!token) {
      return;
    }

    if (type === 'trade.entry' && !entries.has(token)) {
      entries.set(token, payload);
      return;
    }

    if (type === 'trade.exit' && !exits.has(token)) {
      exits.set(token, payload);
    }
  });

  return { entries, exits };
}

function buildTradeCase(pair, token, bucket, ledgerEntry, ledgerExit) {
  const signal = bucket.signal || {};
  const exit = bucket.paperClosed || ledgerExit || {};
  const executed = bucket.tradeExecuted || {};
  const pnl = Number(exit.realizedPnLSol ?? ledgerExit?.realizedPnlSol ?? 0);
  const outcome = pnl > 0 ? 'winner' : 'loser';

  return {
    id: `${pair.stamp}:${token}:${outcome}`,
    replayQuality: 'seed_from_logs',
    historicalPacketAvailable: false,
    sourceFiles: {
      telemetry: pair.telemetryPath,
      strategyLedger: pair.ledgerPath
    },
    runStamp: pair.stamp,
    category: outcome,
    token,
    timestamp: bucket.firstSeenAt,
    outcome: {
      label: outcome,
      exitReason: exit.reason || ledgerExit?.exitReason || null,
      realizedPnLSol: Number.isFinite(pnl) ? Number(pnl.toFixed(9)) : 0,
      pnlPercent: Number(exit.pnlPercent ?? ledgerExit?.pnlPercent ?? 0),
      peakPnlPercent: Number(exit.peakPnlPercent ?? 0),
      holdMinutes: Number(ledgerExit?.holdMinutes ?? 0)
    },
    deterministicSignal: {
      amountSol: Number(signal.amountSol ?? executed.amountSol ?? ledgerEntry?.amountSol ?? 0),
      source: signal.source || ledgerEntry?.source || null,
      qualityScore: Number(signal.qualityScore ?? executed.qualityScore ?? ledgerEntry?.qualityScore ?? 0),
      qualityFactors: signal.qualityFactors || null,
      momentumScore: Number(signal.momentumScore ?? ledgerEntry?.momentumScore ?? exit.momentumScore ?? 0),
      momentumFactors: signal.momentumFactors || null,
      rankScore: Number(signal.rankScore ?? 0)
    },
    ai: {
      action: executed.aiAction || exit.aiAction || null,
      primaryStrategy: executed.aiPrimaryStrategy || exit.aiPrimaryStrategy || ledgerEntry?.strategy || null,
      confidence: Number(executed.aiConfidence ?? ledgerEntry?.aiConfidence ?? 0),
      convergenceScore: Number(executed.aiConvergenceScore ?? ledgerEntry?.convergenceScore ?? exit.aiConvergenceScore ?? 0),
      executionProfile: executed.aiExecutionProfile || ledgerEntry?.executionProfile || exit.aiExecutionProfile || null
    },
    notes: [
      'Seed replay case derived from existing telemetry and strategy-ledger logs.',
      'Historical full AI review packet was not persisted for this run.'
    ]
  };
}

function isRunnerReplayCandidate(token, bucket, ledgerEntry = null) {
  const signalSource = String(bucket.signal?.source || ledgerEntry?.source || '').toLowerCase();
  return signalSource.startsWith('pumpportal');
}

function buildRejectedCase(pair, token, bucket) {
  const signal = bucket.signal || {};
  const aiCaution = bucket.aiCaution || null;
  const aiVeto = bucket.aiVeto || null;
  const rejectionReasons = Array.from(bucket.rejectionReasons.values())
    .filter((item) => !IGNORED_REJECTION_REASONS.has(item.reason))
    .sort((a, b) => b.count - a.count);
  const pumpFailureReasons = Array.from(bucket.pumpFailureReasons.values())
    .sort((a, b) => b.count - a.count);
  const primaryReason = aiCaution?.reason || aiVeto?.reason || rejectionReasons[0]?.reason || pumpFailureReasons[0]?.reason || null;

  if (!primaryReason) {
    return null;
  }

  return {
    id: `${pair.stamp}:${token}:rejected`,
    replayQuality: 'seed_from_logs',
    historicalPacketAvailable: false,
    sourceFiles: {
      telemetry: pair.telemetryPath,
      strategyLedger: pair.ledgerPath
    },
    runStamp: pair.stamp,
    category: 'rejected',
    token,
    timestamp: bucket.firstSeenAt,
    outcome: {
      label: aiCaution ? 'watch' : 'reject',
      primaryReason
    },
    deterministicSignal: {
      amountSol: Number(signal.amountSol ?? 0),
      source: signal.source || null,
      qualityScore: Number(signal.qualityScore ?? 0),
      qualityFactors: signal.qualityFactors || null,
      momentumScore: Number(signal.momentumScore ?? 0),
      momentumFactors: signal.momentumFactors || null,
      rankScore: Number(signal.rankScore ?? 0)
    },
    ai: {
      action: aiCaution ? 'WATCH' : aiVeto ? 'REJECT' : null,
      primaryStrategy: aiCaution?.primaryStrategy || aiVeto?.primaryStrategy || null,
      confidence: Number(aiCaution?.confidence ?? aiVeto?.confidence ?? 0),
      convergenceScore: Number(aiCaution?.convergenceScore ?? aiVeto?.convergenceScore ?? 0),
      reason: aiCaution?.reason || aiVeto?.reason || null,
      strategyScores: aiCaution?.strategyScores || aiVeto?.strategyScores || null
    },
    rejectionReasons,
    pumpFailureReasons,
    notes: [
      'Seed replay case derived from existing telemetry and strategy-ledger logs.',
      'Historical full AI review packet was not persisted for this run.'
    ]
  };
}

function pickBalancedCases(tradeCases, rejectedCases, limit) {
  const winners = tradeCases
    .filter((item) => item.category === 'winner')
    .sort((a, b) => b.outcome.realizedPnLSol - a.outcome.realizedPnLSol);
  const losers = tradeCases
    .filter((item) => item.category === 'loser')
    .sort((a, b) => a.outcome.realizedPnLSol - b.outcome.realizedPnLSol);
  const rejects = rejectedCases
    .sort((a, b) => {
      const aScore = (a.rejectionReasons?.[0]?.count || 0) + (a.ai.action ? 2 : 0);
      const bScore = (b.rejectionReasons?.[0]?.count || 0) + (b.ai.action ? 2 : 0);
      return bScore - aScore;
    });

  const winnerTarget = Math.min(winners.length, Math.max(8, Math.floor(limit * 0.3)));
  const loserTarget = Math.min(losers.length, Math.max(8, Math.floor(limit * 0.25)));
  const rejectTarget = Math.min(rejects.length, Math.max(limit - winnerTarget - loserTarget, 10));

  const selected = [
    ...winners.slice(0, winnerTarget),
    ...losers.slice(0, loserTarget),
    ...rejects.slice(0, rejectTarget)
  ];

  return selected
    .slice(0, limit)
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

async function buildReplaySeed(pairs, limit) {
  const tradeCases = [];
  const rejectedCases = [];

  for (const pair of pairs) {
    const telemetryBuckets = await hydrateTelemetryBuckets(pair.telemetryPath);
    const { entries, exits } = await buildLedgerMaps(pair.ledgerPath);

    for (const [token, bucket] of telemetryBuckets.entries()) {
      const ledgerEntry = entries.get(token) || null;
      const ledgerExit = exits.get(token) || null;

      if (!isRunnerReplayCandidate(token, bucket, ledgerEntry)) {
        continue;
      }

      if (bucket.tradeExecuted && (bucket.paperClosed || ledgerExit)) {
        tradeCases.push(buildTradeCase(pair, token, bucket, ledgerEntry, ledgerExit));
        continue;
      }

      if (bucket.signal) {
        const rejectedCase = buildRejectedCase(pair, token, bucket);
        if (rejectedCase) {
          rejectedCases.push(rejectedCase);
        }
      }
    }
  }

  const selectedCases = pickBalancedCases(tradeCases, rejectedCases, limit);
  const counts = selectedCases.reduce((accumulator, item) => {
    accumulator[item.category] = (accumulator[item.category] || 0) + 1;
    return accumulator;
  }, {});

  return {
    source: 'model_benchmark_replay_seed',
    generatedAt: new Date().toISOString(),
    replayQuality: 'seed_from_logs',
    historicalPacketAvailable: false,
    totalCasesAvailable: {
      winners: tradeCases.filter((item) => item.category === 'winner').length,
      losers: tradeCases.filter((item) => item.category === 'loser').length,
      rejected: rejectedCases.length
    },
    selectedCounts: {
      winners: counts.winner || 0,
      losers: counts.loser || 0,
      rejected: counts.rejected || 0,
      total: selectedCases.length
    },
    notes: [
      'These benchmark cases were built from existing run logs, not from persisted full AI review packets.',
      'Use this pack as a seed set for first model bakeoffs.',
      'Future benchmark-grade capture should persist the full review packet before the model call.'
    ],
    cases: selectedCases
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = clamp(parseInt(args.limit || args._[0] || '36', 10), 12, 80);
  const allPairs = getLogPairs();
  const limitPairs = clamp(parseInt(args.limitPairs || '12', 10), 1, 100);
  const pairs = allPairs.slice(-limitPairs);

  if (pairs.length === 0) {
    throw new Error('No run-log pairs found.');
  }

  const payload = await buildReplaySeed(pairs, limit);
  payload.logPairsAvailable = allPairs.length;
  payload.logPairsScanned = pairs.length;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `replay-seed-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'latest.json');

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved model benchmark replay seed to ${outputPath}`);
  console.log(`Updated latest model benchmark replay seed at ${latestPath}`);
  console.log(
    `selected winners=${payload.selectedCounts.winners} losers=${payload.selectedCounts.losers} rejected=${payload.selectedCounts.rejected} total=${payload.selectedCounts.total}`
  );
}

main().catch((error) => {
  console.error(`Failed to build model benchmark replay seed: ${error.message}`);
  process.exit(1);
});
