const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'run-battlefield-latest.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      if (!args.limit && /^\d+$/.test(arg)) {
        args.limit = arg;
      }
      continue;
    }

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

function resolveRepoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function listJsonl(logDir, prefix) {
  if (!fs.existsSync(logDir)) return [];
  return fs.readdirSync(logDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .map((name) => {
      const fullPath = path.join(logDir, name);
      return { name, fullPath, stat: fs.statSync(fullPath) };
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

function resolveLatest(logDir, prefix) {
  return listJsonl(logDir, prefix)[0]?.fullPath || null;
}

function resolveNearestDossier(logDir, telemetryPath) {
  const dossiers = listJsonl(logDir, 'candidate-dossiers-');
  if (!telemetryPath || dossiers.length === 0) return dossiers[0]?.fullPath || null;

  const telemetryStat = fs.statSync(telemetryPath);
  const telemetryStart = extractStampMs(path.basename(telemetryPath)) || telemetryStat.mtimeMs;
  return dossiers
    .map((candidate) => ({
      ...candidate,
      distance: Math.abs((extractStampMs(candidate.name) || candidate.stat.mtimeMs) - telemetryStart)
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.fullPath || null;
}

function extractStampMs(fileName) {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
  if (!match) return null;
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    'T$1:$2:$3.$4Z'
  );
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return sortCountObject(counts);
}

function sortCountObject(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function topEntries(counts, limit = 10) {
  return Object.fromEntries(Object.entries(counts || {}).slice(0, limit));
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function pct(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : 'n/a';
}

function sol(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric >= 0 ? '+' : ''}${numeric.toFixed(4)} SOL` : 'n/a';
}

function usd(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'n/a';
  if (Math.abs(numeric) >= 1_000_000) return `$${(numeric / 1_000_000).toFixed(2)}M`;
  if (Math.abs(numeric) >= 1_000) return `$${(numeric / 1_000).toFixed(1)}K`;
  return `$${numeric.toFixed(0)}`;
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return compact((end - start) / 1000, 2);
}

function firstLastTimestamps(events) {
  const timestamps = events
    .map((event) => event.timestamp)
    .filter(Boolean)
    .sort();

  return {
    first: timestamps[0] || null,
    last: timestamps[timestamps.length - 1] || null,
    durationSeconds: timestamps.length > 1 ? secondsBetween(timestamps[0], timestamps[timestamps.length - 1]) : null
  };
}

function summarizeSignal(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    mint: payload.token || payload.mint || null,
    symbol: payload.symbol || null,
    source: payload.source || null,
    qualityScore: compact(payload.qualityScore, 4),
    momentumScore: compact(payload.momentumScore, 4),
    rankScore: compact(payload.rankScore, 4),
    amountSol: compact(payload.amountSol, 4),
    reason: payload.reason || null
  };
}

function summarizePaperEntry(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    preset: payload.preset || null,
    mint: payload.mint || null,
    symbol: payload.symbol || null,
    score: compact(payload.score ?? payload.entryScore, 2),
    curveProgress: compact(payload.curveProgress ?? payload.entryCurveProgress, 6),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    entryPriceSol: compact(payload.entryPriceSol, 15),
    amountSol: compact(payload.amountSol, 4)
  };
}

function summarizePaperExit(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    preset: payload.preset || null,
    mint: payload.mint || null,
    symbol: payload.symbol || null,
    reason: payload.reason || null,
    returnPct: compact(payload.returnPct, 6),
    pnlSol: compact(payload.pnlSol, 9),
    holdSeconds: compact(payload.holdSeconds, 2),
    entryCurveProgress: compact(payload.entryCurveProgress, 6),
    exitCurveProgress: compact(payload.exitCurveProgress, 6),
    maxCurveProgress: compact(payload.maxCurveProgress, 6)
  };
}

function summarizeDossier(dossier) {
  return {
    timestamp: dossier.timestamp,
    source: dossier.source,
    eventType: dossier.eventType,
    mint: dossier.identity?.mint || null,
    symbol: dossier.identity?.symbol || null,
    verdict: dossier.gmgnStyle?.verdict || null,
    score: compact(dossier.gmgnStyle?.score, 2),
    curveProgress: compact(dossier.curve?.progress, 6),
    liquidityUsd: compact(dossier.market?.liquidityUsd, 2),
    volumeToLiquidity24h: compact(dossier.market?.volumeToLiquidity24h, 4),
    priceChange1hPct: compact(dossier.market?.priceChange1hPct, 2),
    priceChange6hPct: compact(dossier.market?.priceChange6hPct, 2),
    priceChange24hPct: compact(dossier.market?.priceChange24hPct, 2),
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags.slice(0, 10) : []
  };
}

function groupLatestByMint(dossiers, predicate) {
  const latest = new Map();
  for (const dossier of dossiers) {
    if (!predicate(dossier)) continue;
    const mint = dossier.identity?.mint;
    if (!mint) continue;
    const current = latest.get(mint);
    if (!current || String(dossier.timestamp || '') > String(current.timestamp || '')) {
      latest.set(mint, dossier);
    }
  }

  return Array.from(latest.values());
}

function buildTopWatch(dossiers, limit) {
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'pre_migration_watch'
      && ['watch', 'high_conviction_watch'].includes(dossier.gmgnStyle?.verdict)
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function buildTopMissedWatch(dossiers, paperEntries, limit) {
  const enteredMints = new Set(paperEntries.map((event) => payloadOf(event).mint).filter(Boolean));
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'pre_migration_watch'
      && ['watch', 'high_conviction_watch'].includes(dossier.gmgnStyle?.verdict)
      && !enteredMints.has(dossier.identity?.mint)
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function buildContinuationHighlights(dossiers, verdict, limit) {
  return groupLatestByMint(
    dossiers,
    (dossier) => dossier.source === 'post_migration_continuation'
      && dossier.gmgnStyle?.verdict === verdict
  )
    .sort((a, b) => Number(b.gmgnStyle?.score || 0) - Number(a.gmgnStyle?.score || 0))
    .slice(0, limit)
    .map(summarizeDossier);
}

function summarizePumpGateFailure(event) {
  const payload = payloadOf(event);
  const values = payload.values || {};
  return {
    timestamp: event.timestamp || null,
    mint: payload.token || payload.mint || null,
    reason: payload.reason || null,
    momentumScore: compact(payload.momentumScore, 4),
    threshold: payload.threshold ?? null,
    routeType: values.routeType || null,
    bondingStage: values.bondingStage || null,
    liquidityUsd: compact(values.liquidityUsd, 2)
  };
}

function buildScalperDiagnostics({ pumpFailures, tradeRejected, signalGenerated, signalExecuted }) {
  const pumpFailureCounts = countBy(pumpFailures, (event) => payloadOf(event).reason);
  const quoteRejects = tradeRejected.filter((event) => String(payloadOf(event).reason || '').includes('QUOTE'));
  const aiRejects = tradeRejected.filter((event) => String(payloadOf(event).reason || '').includes('AI_'));
  const notMigratedRejects = pumpFailures.filter((event) => payloadOf(event).reason === 'PUMP_FAIL_NOT_MIGRATED');
  const migratedLiquidityRejects = pumpFailures.filter((event) => payloadOf(event).reason === 'PUMP_FAIL_MIGRATED_LIQUIDITY');
  const migratedCandidateRejects = pumpFailures.filter((event) => {
    const reason = payloadOf(event).reason;
    return reason && reason !== 'PUMP_FAIL_NOT_MIGRATED';
  });

  return {
    posture: signalExecuted.length > 0
      ? 'paper_executed'
      : (signalGenerated.length > 0 ? 'candidate_blocked_after_signal' : 'filtering_only'),
    generatedSignals: signalGenerated.length,
    executedSignals: signalExecuted.length,
    quoteRejects: quoteRejects.length,
    aiRejects: aiRejects.length,
    notMigratedRejects: notMigratedRejects.length,
    migratedLiquidityRejects: migratedLiquidityRejects.length,
    migratedCandidateRejects: migratedCandidateRejects.length,
    pumpFailureCounts,
    recentMigratedLiquidityRejects: migratedLiquidityRejects
      .slice(-8)
      .map(summarizePumpGateFailure),
    recentMigratedCandidateRejects: migratedCandidateRejects
      .slice(-8)
      .map(summarizePumpGateFailure)
  };
}

function buildReport(events, dossiers, options = {}) {
  const limit = Number(options.limit || 8);
  const eventCounts = countBy(events, eventType);
  const timeline = firstLastTimestamps(events);

  const tradeRejected = events.filter((event) => eventType(event) === 'trade.rejected');
  const pumpFailures = events.filter((event) => eventType(event) === 'pump.momentum_gate_failed');
  const signalGenerated = events.filter((event) => eventType(event) === 'signal.generated');
  const signalExecuted = events.filter((event) => eventType(event) === 'signal.executed' || eventType(event) === 'trade.executed');
  const aiEvents = events.filter((event) => {
    const haystack = JSON.stringify(event);
    return eventType(event).startsWith('ai.')
      || haystack.includes('AI_TIMEOUT_FALLBACK')
      || haystack.includes('AI_REVIEW_TIMEOUT')
      || haystack.includes('AI_REVIEW_FAILED');
  });

  const paperDecisions = events.filter((event) => eventType(event) === 'pre_migration_paper.decision');
  const paperEntries = events.filter((event) => eventType(event) === 'pre_migration_paper.entry');
  const paperExits = events.filter((event) => eventType(event) === 'pre_migration_paper.exit');
  const paperPnl = paperExits.reduce((sum, event) => sum + Number(payloadOf(event).pnlSol || 0), 0);

  const continuationDossiers = dossiers.filter((dossier) => dossier.source === 'post_migration_continuation');
  const watchDossiers = dossiers.filter((dossier) => dossier.source === 'pre_migration_watch');
  const paperDossiers = dossiers.filter((dossier) => dossier.source === 'pre_migration_paper');

  const paperPnlByPreset = {};
  for (const exit of paperExits) {
    const payload = payloadOf(exit);
    const preset = payload.preset || 'unknown';
    if (!paperPnlByPreset[preset]) {
      paperPnlByPreset[preset] = { exits: 0, pnlSol: 0, wins: 0, losses: 0 };
    }
    const pnlSol = Number(payload.pnlSol || 0);
    paperPnlByPreset[preset].exits += 1;
    paperPnlByPreset[preset].pnlSol += pnlSol;
    if (pnlSol > 0) paperPnlByPreset[preset].wins += 1;
    if (pnlSol < 0) paperPnlByPreset[preset].losses += 1;
  }

  for (const presetSummary of Object.values(paperPnlByPreset)) {
    presetSummary.pnlSol = compact(presetSummary.pnlSol, 9);
  }

  return {
    generatedAt: new Date().toISOString(),
    files: options.files || {},
    session: {
      firstEventAt: timeline.first,
      lastEventAt: timeline.last,
      durationSeconds: timeline.durationSeconds,
      durationMinutes: timeline.durationSeconds === null ? null : compact(timeline.durationSeconds / 60, 2),
      eventCount: events.length,
      dossierCount: dossiers.length
    },
    eventCounts: topEntries(eventCounts, 30),
    runnerLane: {
      generatedSignals: signalGenerated.length,
      executedSignals: signalExecuted.length,
      rejectedTrades: tradeRejected.length,
      rejectionReasons: countBy(tradeRejected, (event) => payloadOf(event).reason),
      pumpGateFailures: countBy(pumpFailures, (event) => payloadOf(event).reason),
      scalperDiagnostics: buildScalperDiagnostics({
        pumpFailures,
        tradeRejected,
        signalGenerated,
        signalExecuted
      }),
      generated: signalGenerated.map(summarizeSignal),
      executed: signalExecuted.map(summarizeSignal),
      aiTimeoutFallback: uniqueBy(aiEvents
        .filter((event) => JSON.stringify(event).includes('AI_TIMEOUT_FALLBACK'))
        .map((event) => ({
          timestamp: event.timestamp,
          type: eventType(event),
          mint: payloadOf(event).token || payloadOf(event).mint || null,
          reason: payloadOf(event).reason || payloadOf(event).rejectionReason || null,
          qualityScore: compact(payloadOf(event).qualityScore, 4),
          momentumScore: compact(payloadOf(event).momentumScore, 4)
        })), (item) => `${item.mint || 'unknown'}:${item.reason || 'unknown'}`)
    },
    preMigrationPaper: {
      entries: paperEntries.length,
      exits: paperExits.length,
      wins: paperExits.filter((event) => Number(payloadOf(event).pnlSol || 0) > 0).length,
      losses: paperExits.filter((event) => Number(payloadOf(event).pnlSol || 0) < 0).length,
      pnlSol: compact(paperPnl, 9),
      pnlByPreset: paperPnlByPreset,
      decisionCounts: countBy(paperDecisions, (event) => payloadOf(event).decision),
      skipReasons: countBy(paperDecisions, (event) => payloadOf(event).reason),
      entriesDetail: paperEntries.map(summarizePaperEntry),
      exitsDetail: paperExits.map(summarizePaperExit)
    },
    watchLane: {
      uniqueWatchCandidates: groupLatestByMint(watchDossiers, () => true).length,
      verdicts: countBy(watchDossiers, (dossier) => dossier.gmgnStyle?.verdict),
      topWatch: buildTopWatch(dossiers, limit),
      topMissedWatch: buildTopMissedWatch(dossiers, paperEntries, limit)
    },
    continuationLane: {
      verdicts: countBy(continuationDossiers, (dossier) => dossier.gmgnStyle?.verdict),
      confirmed: buildContinuationHighlights(dossiers, 'continuation_confirmed', limit),
      watch: buildContinuationHighlights(dossiers, 'continuation_watch', limit),
      rejectedReasons: countBy(
        continuationDossiers.filter((dossier) => String(dossier.gmgnStyle?.verdict || '').startsWith('continuation_rejected:')),
        (dossier) => dossier.continuation?.rejectReason || String(dossier.gmgnStyle?.verdict || '').split(':')[1]
      )
    },
    dossiers: {
      bySource: countBy(dossiers, (dossier) => dossier.source),
      byVerdict: topEntries(countBy(dossiers, (dossier) => dossier.gmgnStyle?.verdict), 30),
      recent: dossiers.slice(-limit).map(summarizeDossier),
      paperDossiers: paperDossiers.length,
      watchDossiers: watchDossiers.length,
      continuationDossiers: continuationDossiers.length
    }
  };
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printCountObject(counts, empty = 'none') {
  const entries = Object.entries(counts || {});
  if (entries.length === 0) {
    console.log(`  ${empty}`);
    return;
  }

  for (const [key, value] of entries) {
    console.log(`  ${key}: ${value}`);
  }
}

function printCandidateList(items, empty = 'none') {
  if (!items || items.length === 0) {
    console.log(`  ${empty}`);
    return;
  }

  for (const item of items) {
    const label = item.symbol || item.mint || 'unknown';
    const score = item.score === null ? 'n/a' : item.score;
    const curve = item.curveProgress === null ? '' : ` curve=${pct(item.curveProgress)}`;
    const liq = item.liquidityUsd === null ? '' : ` liq=${usd(item.liquidityUsd)}`;
    const changes = [
      item.priceChange1hPct === null ? null : `1h=${item.priceChange1hPct}%`,
      item.priceChange6hPct === null ? null : `6h=${item.priceChange6hPct}%`,
      item.priceChange24hPct === null ? null : `24h=${item.priceChange24hPct}%`
    ].filter(Boolean).join(' ');
    console.log(`  ${label}: score=${score} ${item.verdict || ''}${curve}${liq}${changes ? ` ${changes}` : ''}`);
    if (item.mint) console.log(`    ${item.mint}`);
    if (item.tags?.length) console.log(`    tags=${item.tags.join(',')}`);
  }
}

function printReport(report) {
  console.log('Run Battlefield Report');
  console.log('======================');
  console.log(`Telemetry: ${report.files.telemetryPath || 'n/a'}`);
  console.log(`Dossiers:  ${report.files.dossierPath || 'n/a'}`);
  console.log(`Window:    ${report.session.firstEventAt || 'n/a'} -> ${report.session.lastEventAt || 'n/a'} (${report.session.durationMinutes ?? 'n/a'} min)`);
  console.log(`Events:    ${report.session.eventCount}`);
  console.log(`Dossiers:  ${report.session.dossierCount}`);

  printSection('Runner Lane');
  console.log(`  signals=${report.runnerLane.generatedSignals} executed=${report.runnerLane.executedSignals} rejected=${report.runnerLane.rejectedTrades}`);
  console.log('  rejection reasons:');
  printCountObject(report.runnerLane.rejectionReasons);
  if (report.runnerLane.pumpGateFailures && Object.keys(report.runnerLane.pumpGateFailures).length > 0) {
    console.log('  pump gate failures:');
    printCountObject(report.runnerLane.pumpGateFailures);
  }
  if (report.runnerLane.scalperDiagnostics) {
    const diag = report.runnerLane.scalperDiagnostics;
    console.log(`  scalper diagnostics: posture=${diag.posture} migratedRejects=${diag.migratedCandidateRejects} liquidityRejects=${diag.migratedLiquidityRejects} quoteRejects=${diag.quoteRejects} aiRejects=${diag.aiRejects}`);
    if (diag.recentMigratedLiquidityRejects?.length > 0) {
      console.log('  recent migrated liquidity rejects:');
      for (const item of diag.recentMigratedLiquidityRejects) {
        console.log(`  ${item.reason}: liq=${usd(item.liquidityUsd)} threshold=${usd(item.threshold)} m=${item.momentumScore}`);
        if (item.mint) console.log(`    ${item.mint}`);
      }
    }
  }
  if (report.runnerLane.generated.length > 0) {
    console.log('  generated signals:');
    for (const signal of report.runnerLane.generated) {
      console.log(`  ${signal.symbol || signal.mint}: q=${signal.qualityScore} m=${signal.momentumScore} rank=${signal.rankScore}`);
      console.log(`    ${signal.mint}`);
    }
  }
  if (report.runnerLane.aiTimeoutFallback.length > 0) {
    console.log('  AI timeout fallback:');
    for (const item of report.runnerLane.aiTimeoutFallback) {
      console.log(`  ${item.type}: ${item.reason}`);
      if (item.mint) console.log(`    ${item.mint}`);
    }
  }

  printSection('Pre-Migration Paper');
  console.log(`  entries=${report.preMigrationPaper.entries} exits=${report.preMigrationPaper.exits} wins=${report.preMigrationPaper.wins} losses=${report.preMigrationPaper.losses} pnl=${sol(report.preMigrationPaper.pnlSol)}`);
  console.log('  decisions:');
  printCountObject(report.preMigrationPaper.decisionCounts);
  console.log('  skip reasons:');
  printCountObject(report.preMigrationPaper.skipReasons);
  if (report.preMigrationPaper.exitsDetail.length > 0) {
    console.log('  exits:');
    for (const exit of report.preMigrationPaper.exitsDetail) {
      console.log(`  ${exit.symbol || exit.mint} ${exit.preset}: ${exit.reason} return=${pct(exit.returnPct)} pnl=${sol(exit.pnlSol)} hold=${exit.holdSeconds}s`);
      console.log(`    ${exit.mint}`);
    }
  }

  printSection('Watch Lane');
  console.log(`  unique candidates=${report.watchLane.uniqueWatchCandidates}`);
  console.log('  verdicts:');
  printCountObject(report.watchLane.verdicts);
  console.log('  top watch:');
  printCandidateList(report.watchLane.topWatch);
  console.log('  top missed watch:');
  printCandidateList(report.watchLane.topMissedWatch);

  printSection('Continuation Lane');
  console.log('  verdicts:');
  printCountObject(report.continuationLane.verdicts);
  console.log('  rejected reasons:');
  printCountObject(report.continuationLane.rejectedReasons);
  console.log('  confirmed:');
  printCandidateList(report.continuationLane.confirmed);
  console.log('  watch:');
  printCandidateList(report.continuationLane.watch);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logDir = resolveRepoPath(args.logDir) || DEFAULT_LOG_DIR;
  const telemetryPath = resolveRepoPath(args.telemetry) || resolveLatest(logDir, 'telemetry-');
  const dossierPath = resolveRepoPath(args.dossier) || resolveNearestDossier(logDir, telemetryPath);
  const outputPath = resolveRepoPath(args.out) || DEFAULT_OUTPUT_PATH;

  if (!telemetryPath) {
    throw new Error(`No telemetry JSONL file found in ${logDir}`);
  }

  const events = readJsonl(telemetryPath);
  const dossiers = readJsonl(dossierPath);
  const report = buildReport(events, dossiers, {
    limit: Number(args.limit || 8),
    files: {
      telemetryPath,
      dossierPath
    }
  });

  writeJson(outputPath, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
    console.log(`\nWrote JSON report: ${outputPath}`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`run-battlefield-report failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReport,
  readJsonl,
  resolveLatest,
  resolveNearestDossier
};
