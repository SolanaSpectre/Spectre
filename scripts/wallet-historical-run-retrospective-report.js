const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTCOME_LEDGER_JSONL_PATH = path.join(ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');
const OUTCOME_LEDGER_REPORT_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-historical-run-retrospective');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-historical-run-retrospective-latest.json');

const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);
const INTERESTING_OUTCOMES = new Set([...POSITIVE_OUTCOMES, 'INTERESTING_75']);

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const rows = [];
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let carry = '';

  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      carry += buffer.toString('utf8', 0, bytesRead);
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        try {
          rows.push(JSON.parse(line.replace(/^\uFEFF/, '')));
        } catch {
          // Ignore malformed rows so one partial append does not break the report.
        }
      }
    }
    if (carry.trim()) {
      try {
        rows.push(JSON.parse(carry.replace(/^\uFEFF/, '')));
      } catch {
        // Ignore a partial final row from an interrupted append.
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return rows;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function lift(rate, baseline) {
  return rate !== null && baseline !== null && baseline > 0
    ? Number((rate / baseline).toFixed(4))
    : null;
}

function compareIso(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

function outcomeMap(outcomeLedger) {
  return new Map((outcomeLedger?.outcomes || [])
    .filter((item) => item.mint)
    .map((item) => [item.mint, item]));
}

function reviewTierByWallet(review) {
  return new Map((review?.wallets || [])
    .filter((wallet) => wallet.walletAddress)
    .map((wallet) => [wallet.walletAddress, {
      reviewTier: wallet.reviewTier || 'UNKNOWN',
      evidenceTier: wallet.evidenceTier || null,
      name: wallet.name || null
    }]));
}

function buildSessions(events) {
  const byId = new Map();
  for (const event of events) {
    if (!event.sessionId || !event.kind?.startsWith('session.')) continue;
    if (!byId.has(event.sessionId)) {
      byId.set(event.sessionId, {
        sessionId: event.sessionId,
        startedAt: null,
        stoppedAt: null,
        mode: event.session?.mode || null
      });
    }
    const session = byId.get(event.sessionId);
    if (event.kind === 'session.started') {
      session.startedAt = event.session?.startedAt || event.timestamp || session.startedAt;
      session.mode = event.session?.mode || session.mode;
    }
    if (event.kind === 'session.stopped') {
      session.stoppedAt = event.session?.stoppedAt || event.timestamp || session.stoppedAt;
    }
  }

  const sessions = Array.from(byId.values())
    .filter((session) => session.startedAt)
    .sort((a, b) => compareIso(a.startedAt, b.startedAt));

  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!session.stoppedAt && sessions[index + 1]?.startedAt) {
      session.inferredStoppedAt = sessions[index + 1].startedAt;
    } else {
      session.inferredStoppedAt = session.stoppedAt || null;
    }
  }

  return sessions;
}

function sessionForTimestamp(sessions, timestamp) {
  const time = new Date(timestamp || 0).getTime();
  if (!Number.isFinite(time)) return null;
  return sessions.find((session) => {
    const start = new Date(session.startedAt).getTime();
    const stop = session.inferredStoppedAt ? new Date(session.inferredStoppedAt).getTime() : Number.POSITIVE_INFINITY;
    return time >= start && time <= stop;
  }) || null;
}

function buildFirstTouches(walletEvents) {
  const firstByWalletMint = new Map();
  for (const event of walletEvents) {
    if (!event.wallet || !event.mint) continue;
    const key = `${event.wallet}:${event.mint}`;
    const existing = firstByWalletMint.get(key);
    if (!existing || compareIso(event.tradeAt || event.observedAt, existing.tradeAt || existing.observedAt) < 0) {
      firstByWalletMint.set(key, event);
    }
  }
  return Array.from(firstByWalletMint.values());
}

function buildClusters(walletEvents) {
  const byMint = new Map();
  for (const touch of buildFirstTouches(walletEvents)) {
    if (!byMint.has(touch.mint)) {
      byMint.set(touch.mint, {
        mint: touch.mint,
        symbol: touch.symbol || null,
        name: touch.name || null,
        firstSeenAt: touch.tradeAt || touch.observedAt || null,
        touches: []
      });
    }
    const cluster = byMint.get(touch.mint);
    cluster.touches.push(touch);
    if (compareIso(touch.tradeAt || touch.observedAt, cluster.firstSeenAt) < 0) {
      cluster.firstSeenAt = touch.tradeAt || touch.observedAt || cluster.firstSeenAt;
    }
  }
  return Array.from(byMint.values());
}

function clusterRows(walletEvents, reviews, outcomes, sessions) {
  return buildClusters(walletEvents).map((cluster) => {
    const session = sessionForTimestamp(sessions, cluster.firstSeenAt);
    const reviewTiers = new Set();
    const walletNames = new Set();
    for (const touch of cluster.touches || []) {
      const review = reviews.get(touch.wallet);
      if (!review) continue;
      reviewTiers.add(review.reviewTier);
      if (review.name || touch.walletProfile?.name) walletNames.add(review.name || touch.walletProfile?.name);
    }
    const outcome = outcomes.get(cluster.mint) || {};
    const totalFirstTouchSol = cluster.touches.reduce((sum, touch) => sum + Number(touch.amount?.sol || 0), 0);
    return {
      sessionId: session?.sessionId || null,
      runStartedAt: session?.startedAt || null,
      runStoppedAt: session?.stoppedAt || null,
      mint: cluster.mint,
      symbol: cluster.symbol || null,
      reviewTiers: Array.from(reviewTiers).sort(),
      walletNames: Array.from(walletNames).sort(),
      uniqueWalletCount: cluster.touches.length,
      totalFirstTouchSol: Number(totalFirstTouchSol.toFixed(6)),
      outcome: outcome.outcome || 'UNKNOWN',
      paperEntries: outcome.paperEntries || 0,
      paperExits: outcome.paperExits || 0,
      paperPnlSol: outcome.paperPnlSol || 0
    };
  }).filter((row) => row.sessionId);
}

function summarizeRows(label, rows, baselinePositiveRate, baselineInterestingRate) {
  const outcomeCounts = {};
  let positiveCount = 0;
  let interestingCount = 0;
  let paperEntries = 0;
  let paperWins = 0;
  let paperLosses = 0;
  let paperPnlSol = 0;

  for (const row of rows) {
    outcomeCounts[row.outcome] = (outcomeCounts[row.outcome] || 0) + 1;
    if (POSITIVE_OUTCOMES.has(row.outcome)) positiveCount += 1;
    if (INTERESTING_OUTCOMES.has(row.outcome)) interestingCount += 1;
    paperEntries += Number(row.paperEntries || 0);
    if (row.outcome === 'PAPER_WIN') paperWins += 1;
    if (row.outcome === 'PAPER_LOSS') paperLosses += 1;
    paperPnlSol += Number(row.paperPnlSol || 0);
  }

  const positiveRate = pct(positiveCount, rows.length);
  const interestingRate = pct(interestingCount, rows.length);
  return {
    label,
    clusters: rows.length,
    outcomeCounts,
    positiveCount,
    positiveRate,
    positiveLiftVsLedger: lift(positiveRate, baselinePositiveRate),
    interestingCount,
    interestingRate,
    interestingLiftVsLedger: lift(interestingRate, baselineInterestingRate),
    paperEntries,
    paperWins,
    paperLosses,
    paperPnlSol: Number(paperPnlSol.toFixed(6)),
    tinyDenominatorWarning: rows.length < 10 || positiveCount < 3
  };
}

function buildReport(events, walletEvents, promotionReview, outcomeLedger) {
  const sessions = buildSessions(events);
  const reviews = reviewTierByWallet(promotionReview);
  const outcomes = outcomeMap(outcomeLedger);
  const rows = clusterRows(walletEvents, reviews, outcomes, sessions);

  const baseOutcomeCounts = outcomeLedger?.summary?.outcomeCounts || {};
  const ledgerTotal = Object.values(baseOutcomeCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const ledgerPositive = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => POSITIVE_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const ledgerInteresting = Object.entries(baseOutcomeCounts)
    .filter(([outcome]) => INTERESTING_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const baselinePositiveRate = pct(ledgerPositive, ledgerTotal);
  const baselineInterestingRate = pct(ledgerInteresting, ledgerTotal);

  const runs = sessions.map((session) => {
    const runRows = rows.filter((row) => row.sessionId === session.sessionId);
    const trustRows = runRows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW'));
    const avoidRows = runRows.filter((row) => row.reviewTiers.includes('AVOID_REVIEW'));
    const mixedRows = runRows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW') && row.reviewTiers.includes('AVOID_REVIEW'));
    const trustOnlyRows = trustRows.filter((row) => !row.reviewTiers.includes('AVOID_REVIEW'));
    const avoidOnlyRows = avoidRows.filter((row) => !row.reviewTiers.includes('TRUST_REVIEW'));
    return {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      stoppedAt: session.stoppedAt,
      inferredStoppedAt: session.inferredStoppedAt,
      mode: session.mode,
      allWalletTouched: summarizeRows('allWalletTouched', runRows, baselinePositiveRate, baselineInterestingRate),
      trustReviewTouched: summarizeRows('trustReviewTouched', trustRows, baselinePositiveRate, baselineInterestingRate),
      trustReviewOnly: summarizeRows('trustReviewOnly', trustOnlyRows, baselinePositiveRate, baselineInterestingRate),
      avoidReviewTouched: summarizeRows('avoidReviewTouched', avoidRows, baselinePositiveRate, baselineInterestingRate),
      avoidReviewOnly: summarizeRows('avoidReviewOnly', avoidOnlyRows, baselinePositiveRate, baselineInterestingRate),
      mixedTrustAvoidTouched: summarizeRows('mixedTrustAvoidTouched', mixedRows, baselinePositiveRate, baselineInterestingRate)
    };
  });

  const runsWithTouches = runs.filter((run) => run.allWalletTouched.clusters > 0);
  const aggregateTrustRows = rows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW'));
  const aggregateAvoidRows = rows.filter((row) => row.reviewTiers.includes('AVOID_REVIEW'));
  const aggregateMixedRows = rows.filter((row) => row.reviewTiers.includes('TRUST_REVIEW') && row.reviewTiers.includes('AVOID_REVIEW'));
  const aggregateTrustOnlyRows = aggregateTrustRows.filter((row) => !row.reviewTiers.includes('AVOID_REVIEW'));
  const aggregateAvoidOnlyRows = aggregateAvoidRows.filter((row) => !row.reviewTiers.includes('TRUST_REVIEW'));

  return {
    summary: {
      sessions: sessions.length,
      sessionsWithWalletTouches: runsWithTouches.length,
      historicalWalletClusters: rows.length,
      ledgerPositiveRate: baselinePositiveRate,
      ledgerInterestingRate: baselineInterestingRate
    },
    aggregate: {
      allWalletTouched: summarizeRows('allWalletTouched', rows, baselinePositiveRate, baselineInterestingRate),
      trustReviewTouched: summarizeRows('trustReviewTouched', aggregateTrustRows, baselinePositiveRate, baselineInterestingRate),
      trustReviewOnly: summarizeRows('trustReviewOnly', aggregateTrustOnlyRows, baselinePositiveRate, baselineInterestingRate),
      avoidReviewTouched: summarizeRows('avoidReviewTouched', aggregateAvoidRows, baselinePositiveRate, baselineInterestingRate),
      avoidReviewOnly: summarizeRows('avoidReviewOnly', aggregateAvoidOnlyRows, baselinePositiveRate, baselineInterestingRate),
      mixedTrustAvoidTouched: summarizeRows('mixedTrustAvoidTouched', aggregateMixedRows, baselinePositiveRate, baselineInterestingRate)
    },
    runs: runsWithTouches,
    rows
  };
}

function main() {
  const events = readJsonl(OUTCOME_LEDGER_JSONL_PATH);
  const walletEvents = readJsonl(WALLET_EVENTS_PATH);
  const promotionReview = readJson(PROMOTION_REVIEW_PATH, {});
  const outcomeLedger = readJson(OUTCOME_LEDGER_REPORT_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(events, walletEvents, promotionReview, outcomeLedger);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_historical_run_retrospective',
    sources: {
      outcomeLedgerJsonlPath: path.relative(ROOT, OUTCOME_LEDGER_JSONL_PATH).replace(/\\/g, '/'),
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null,
      walletEventsPath: path.relative(ROOT, WALLET_EVENTS_PATH).replace(/\\/g, '/'),
      walletEventsCount: walletEvents.length,
      promotionReviewGeneratedAt: promotionReview.generatedAt || null
    },
    note: 'Report-only run-by-run retrospective joining historical paper sessions, wallet first-touch clusters, wallet review tiers, and downstream outcomes. Use for evidence gathering, not automatic runtime trust mutation.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-historical-run-retrospective-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet historical run retrospective report: ${reportPath}`);
  console.log(`Wrote latest wallet historical run retrospective report: ${LATEST_PATH}`);
  console.log(`sessions=${payload.summary.sessions} touchedRuns=${payload.summary.sessionsWithWalletTouches} clusters=${payload.summary.historicalWalletClusters}`);
}

main();
