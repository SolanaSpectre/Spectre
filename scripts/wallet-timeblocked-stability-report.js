const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTCOME_LEDGER_JSONL_PATH = path.join(ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');
const OUTCOME_LEDGER_REPORT_PATH = path.join(ROOT, 'data', 'reports', 'outcome-ledger-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const PNL_EVIDENCE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-pnl-evidence-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-timeblocked-stability');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-timeblocked-stability-latest.json');

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
      if (!bytesRead) break;
      carry += buffer.toString('utf8', 0, bytesRead);
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        try {
          rows.push(JSON.parse(line.replace(/^\uFEFF/, '')));
        } catch {
          // Ignore malformed rows.
        }
      }
    }
    if (carry.trim()) {
      try {
        rows.push(JSON.parse(carry.replace(/^\uFEFF/, '')));
      } catch {
        // Ignore partial tail.
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

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
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

function canonicalName(name, walletAddress) {
  const label = String(name || walletAddress || '').trim();
  if (/^Cupsey(?:\s+\d+)?$/i.test(label)) return 'Cupsey';
  return label || walletAddress;
}

function buildSessions(events) {
  const byId = new Map();
  for (const event of events) {
    if (!event.sessionId || !event.kind?.startsWith('session.')) continue;
    if (!byId.has(event.sessionId)) {
      byId.set(event.sessionId, { sessionId: event.sessionId, startedAt: null, stoppedAt: null, mode: event.session?.mode || null });
    }
    const session = byId.get(event.sessionId);
    if (event.kind === 'session.started') {
      session.startedAt = event.session?.startedAt || event.timestamp || session.startedAt;
      session.mode = event.session?.mode || session.mode;
    }
    if (event.kind === 'session.stopped') session.stoppedAt = event.session?.stoppedAt || event.timestamp || session.stoppedAt;
  }
  const sessions = Array.from(byId.values()).filter((session) => session.startedAt).sort((a, b) => compareIso(a.startedAt, b.startedAt));
  for (let i = 0; i < sessions.length; i += 1) {
    sessions[i].inferredStoppedAt = sessions[i].stoppedAt || sessions[i + 1]?.startedAt || null;
  }
  return sessions;
}

function sessionForTimestamp(sessions, timestamp) {
  const time = new Date(timestamp || 0).getTime();
  return sessions.find((session) => {
    const start = new Date(session.startedAt).getTime();
    const stop = session.inferredStoppedAt ? new Date(session.inferredStoppedAt).getTime() : Number.POSITIVE_INFINITY;
    return time >= start && time <= stop;
  }) || null;
}

function outcomeMap(outcomeLedger) {
  return new Map((outcomeLedger?.outcomes || []).filter((item) => item.mint).map((item) => [item.mint, item]));
}

function evidenceByCanonicalWallet(pnlEvidence) {
  const grouped = new Map();
  for (const wallet of pnlEvidence?.wallets || []) {
    const key = canonicalName(wallet.name, wallet.walletAddress);
    if (!grouped.has(key)) {
      grouped.set(key, {
        canonicalWallet: key,
        memberWallets: [],
        evidenceTiers: new Set(),
        realizedPositionCount: 0,
        winners: 0,
        losers: 0,
        realizedPnlSol: 0
      });
    }
    const bucket = grouped.get(key);
    bucket.memberWallets.push({ walletAddress: wallet.walletAddress, name: wallet.name || null });
    bucket.evidenceTiers.add(wallet.evidenceTier);
    bucket.realizedPositionCount += Number(wallet.realizedPositionCount || 0);
    bucket.winners += Number(wallet.winners || 0);
    bucket.losers += Number(wallet.losers || 0);
    bucket.realizedPnlSol += Number(wallet.realizedPnlSol || 0);
  }
  for (const bucket of grouped.values()) {
    if (bucket.evidenceTiers.has('PROVEN_POSITIVE')) bucket.evidenceTier = 'PROVEN_POSITIVE';
    else if (bucket.evidenceTiers.has('PROMISING_POSITIVE')) bucket.evidenceTier = 'PROMISING_POSITIVE';
    else if (bucket.evidenceTiers.has('NEGATIVE_EVIDENCE')) bucket.evidenceTier = 'NEGATIVE_EVIDENCE';
    else bucket.evidenceTier = 'INSUFFICIENT_EVIDENCE';
    bucket.evidenceTiers = Array.from(bucket.evidenceTiers).sort();
    bucket.realizedPnlSol = compact(bucket.realizedPnlSol, 8);
  }
  return grouped;
}

function buildFirstTouches(walletEvents, evidenceIndex) {
  const firstByWalletMint = new Map();
  for (const event of walletEvents) {
    if (!event.wallet || !event.mint) continue;
    const name = event.walletProfile?.name || event.wallet;
    const canonicalWallet = canonicalName(name, event.wallet);
    const key = `${canonicalWallet}:${event.mint}`;
    const existing = firstByWalletMint.get(key);
    if (!existing || compareIso(event.tradeAt || event.observedAt, existing.tradeAt || existing.observedAt) < 0) {
      firstByWalletMint.set(key, { ...event, canonicalWallet, evidence: evidenceIndex.get(canonicalWallet) || null });
    }
  }
  return Array.from(firstByWalletMint.values());
}

function buildClusters(firstTouches, sessions, outcomes) {
  const byMint = new Map();
  for (const touch of firstTouches) {
    if (!byMint.has(touch.mint)) {
      byMint.set(touch.mint, { mint: touch.mint, symbol: touch.symbol || null, firstSeenAt: touch.tradeAt || touch.observedAt, touches: [] });
    }
    const cluster = byMint.get(touch.mint);
    cluster.touches.push(touch);
    if (compareIso(touch.tradeAt || touch.observedAt, cluster.firstSeenAt) < 0) cluster.firstSeenAt = touch.tradeAt || touch.observedAt;
  }
  return Array.from(byMint.values()).map((cluster) => {
    const session = sessionForTimestamp(sessions, cluster.firstSeenAt);
    const outcome = outcomes.get(cluster.mint) || {};
    return {
      ...cluster,
      sessionId: session?.sessionId || null,
      startedAt: session?.startedAt || null,
      outcome: outcome.outcome || 'UNKNOWN',
      paperEntries: outcome.paperEntries || 0,
      paperPnlSol: outcome.paperPnlSol || 0
    };
  }).filter((cluster) => cluster.sessionId);
}

function historicalStatsBefore(firstTouches, canonicalWallet, cutoff) {
  const touches = firstTouches.filter((touch) =>
    touch.canonicalWallet === canonicalWallet
    && compareIso(touch.tradeAt || touch.observedAt, cutoff) < 0
  );
  const uniqueMints = new Set(touches.map((touch) => touch.mint));
  const firstBuyTouches = touches.filter((touch) => touch.side === 'buy').length;
  return {
    clusterCount: uniqueMints.size,
    priorityClusterCount: uniqueMints.size,
    firstBuyTouches,
    firstBuyRatio: pct(firstBuyTouches, uniqueMints.size)
  };
}

function timeblockedTier(evidenceTier, stats) {
  const usefulEarly = stats.priorityClusterCount >= 3
    && stats.firstBuyTouches >= 3
    && Number(stats.firstBuyRatio || 0) >= 0.5;
  if (evidenceTier === 'PROVEN_POSITIVE' && usefulEarly) return 'TRUST_REVIEW';
  if (evidenceTier === 'PROVEN_POSITIVE') return 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE';
  if (evidenceTier === 'PROMISING_POSITIVE') return 'WATCH_REVIEW';
  if (evidenceTier === 'NEGATIVE_EVIDENCE') return 'AVOID_REVIEW';
  return 'HOLD';
}

function summarize(label, rows, baselinePositiveRate) {
  const positiveCount = rows.filter((row) => POSITIVE_OUTCOMES.has(row.outcome)).length;
  const interestingCount = rows.filter((row) => INTERESTING_OUTCOMES.has(row.outcome)).length;
  const paperEntries = rows.reduce((sum, row) => sum + Number(row.paperEntries || 0), 0);
  const paperPnlSol = rows.reduce((sum, row) => sum + Number(row.paperPnlSol || 0), 0);
  return {
    label,
    clusters: rows.length,
    positiveCount,
    positiveRate: pct(positiveCount, rows.length),
    positiveLiftVsLedger: lift(pct(positiveCount, rows.length), baselinePositiveRate),
    interestingCount,
    interestingRate: pct(interestingCount, rows.length),
    paperEntries,
    paperPnlSol: compact(paperPnlSol, 6),
    tinyDenominatorWarning: rows.length < 10 || positiveCount < 3
  };
}

function buildReport(events, walletEvents, pnlEvidence, outcomeLedger) {
  const sessions = buildSessions(events);
  const outcomes = outcomeMap(outcomeLedger);
  const evidenceIndex = evidenceByCanonicalWallet(pnlEvidence);
  const firstTouches = buildFirstTouches(walletEvents, evidenceIndex);
  const clusters = buildClusters(firstTouches, sessions, outcomes);
  const baseCounts = outcomeLedger?.summary?.outcomeCounts || {};
  const total = Object.values(baseCounts).reduce((sum, count) => sum + Number(count || 0), 0);
  const positive = Object.entries(baseCounts).filter(([outcome]) => POSITIVE_OUTCOMES.has(outcome)).reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const baselinePositiveRate = pct(positive, total);

  const rows = [];
  for (const cluster of clusters) {
    for (const touch of cluster.touches) {
      const evidence = touch.evidence;
      if (!evidence) continue;
      const stats = historicalStatsBefore(firstTouches, touch.canonicalWallet, cluster.startedAt);
      rows.push({
        sessionId: cluster.sessionId,
        startedAt: cluster.startedAt,
        mint: cluster.mint,
        symbol: cluster.symbol,
        canonicalWallet: touch.canonicalWallet,
        memberWalletCount: evidence.memberWallets.length,
        evidenceTier: evidence.evidenceTier,
        reviewTierAtRun: timeblockedTier(evidence.evidenceTier, stats),
        priorClusterCount: stats.clusterCount,
        priorFirstBuyTouches: stats.firstBuyTouches,
        priorFirstBuyRatio: stats.firstBuyRatio,
        outcome: cluster.outcome,
        paperEntries: cluster.paperEntries,
        paperPnlSol: cluster.paperPnlSol
      });
    }
  }

  const uniqueMintWalletRows = Array.from(new Map(rows.map((row) => [`${row.canonicalWallet}:${row.mint}`, row])).values());
  const byTier = {};
  for (const tier of ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE', 'WATCH_REVIEW', 'AVOID_REVIEW', 'HOLD']) {
    byTier[tier] = summarize(tier, uniqueMintWalletRows.filter((row) => row.reviewTierAtRun === tier), baselinePositiveRate);
  }
  const walletSummaries = Array.from(new Set(uniqueMintWalletRows.map((row) => row.canonicalWallet))).map((wallet) => {
    const walletRows = uniqueMintWalletRows.filter((row) => row.canonicalWallet === wallet);
    const trustEligibleRows = walletRows.filter((row) => row.reviewTierAtRun === 'TRUST_REVIEW');
    return {
      canonicalWallet: wallet,
      evidenceTier: walletRows[0]?.evidenceTier || null,
      touchedMints: walletRows.length,
      trustEligibleMints: trustEligibleRows.length,
      all: summarize(wallet, walletRows, baselinePositiveRate),
      trustEligible: summarize(`${wallet}:TRUST_REVIEW`, trustEligibleRows, baselinePositiveRate)
    };
  }).sort((a, b) => Number(b.trustEligible.positiveRate || 0) - Number(a.trustEligible.positiveRate || 0));

  return {
    summary: {
      sessions: sessions.length,
      canonicalWallets: evidenceIndex.size,
      rawWalletEvents: walletEvents.length,
      canonicalFirstTouches: firstTouches.length,
      historicalClusters: clusters.length,
      evaluatedWalletMintRows: uniqueMintWalletRows.length,
      baselinePositiveRate
    },
    aliasGroups: Array.from(evidenceIndex.values()).filter((item) => item.memberWallets.length > 1),
    byTier,
    stableTrustEligibleWallets: walletSummaries.filter((wallet) => wallet.trustEligible.clusters >= 5 && !wallet.trustEligible.tinyDenominatorWarning),
    wallets: walletSummaries,
    rows: uniqueMintWalletRows
  };
}

function main() {
  const events = readJsonl(OUTCOME_LEDGER_JSONL_PATH);
  const walletEvents = readJsonl(WALLET_EVENTS_PATH);
  const pnlEvidence = readJson(PNL_EVIDENCE_PATH, {});
  const outcomeLedger = readJson(OUTCOME_LEDGER_REPORT_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(events, walletEvents, pnlEvidence, outcomeLedger);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_timeblocked_stability',
    note: 'Report-only canonical-wallet stability review. First-touch eligibility is time-blocked to data available before each run. Realized-PnL evidence tiers are current snapshots, not historical PnL snapshots, and remain a known look-ahead limitation.',
    sources: {
      pnlEvidenceGeneratedAt: pnlEvidence.generatedAt || null,
      outcomeLedgerGeneratedAt: outcomeLedger.generatedAt || null
    },
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-timeblocked-stability-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet timeblocked stability report: ${reportPath}`);
  console.log(`Wrote latest wallet timeblocked stability report: ${LATEST_PATH}`);
  console.log(`canonicalWallets=${payload.summary.canonicalWallets} rows=${payload.summary.evaluatedWalletMintRows}`);
}

main();
