const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LOG_DIR = path.join(REPO_ROOT, 'run-logs');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'mint-specimens');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      args._.push(arg);
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

function resolveFilePairs(args, logDir) {
  if (args.telemetry || args.dossier) {
    const telemetryPath = resolveRepoPath(args.telemetry);
    const dossierPath = resolveRepoPath(args.dossier) || resolveNearestDossier(logDir, telemetryPath);
    return [{ telemetryPath, dossierPath }];
  }

  const telemetryFiles = listJsonl(logDir, 'telemetry-');
  const limitRuns = Number(args.limitRuns || 10);
  const selectedTelemetry = args.all ? telemetryFiles.slice(0, limitRuns) : telemetryFiles.slice(0, 1);

  return selectedTelemetry.map((item) => ({
    telemetryPath: item.fullPath,
    dossierPath: resolveNearestDossier(logDir, item.fullPath)
  }));
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

function eventMint(event) {
  const payload = payloadOf(event);
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function dossierMint(dossier) {
  return dossier.identity?.mint || dossier.mint || null;
}

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function compact(value, decimals = 4) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '') ?? null;
}

function secondsBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return compact((end - start) / 1000, 2);
}

function pct(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : 'n/a';
}

function sol(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric >= 0 ? '+' : ''}${numeric.toFixed(4)} SOL` : 'n/a';
}

function summarizeEvent(event) {
  const payload = payloadOf(event);
  return {
    timestamp: event.timestamp,
    type: eventType(event),
    mint: eventMint(event),
    symbol: payload.symbol || null,
    source: payload.source || null,
    reason: payload.reason || payload.rejectionReason || null,
    decision: payload.decision || null,
    preset: payload.preset || null,
    score: compact(payload.score ?? payload.entryScore, 2),
    qualityScore: compact(payload.qualityScore, 4),
    momentumScore: compact(payload.momentumScore, 4),
    rankScore: compact(payload.rankScore, 4),
    curveProgress: compact(payload.curveProgress ?? payload.entryCurveProgress ?? payload.exitCurveProgress, 6),
    priceSol: compact(payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.entryPriceSol ?? payload.exitPriceSol, 15),
    recentVolumeSol: compact(payload.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(payload.tradeVelocityPerMin, 2),
    returnPct: compact(payload.returnPct, 6),
    pnlSol: compact(payload.pnlSol, 9),
    holdSeconds: compact(payload.holdSeconds, 2)
  };
}

function summarizeDossier(dossier) {
  return {
    timestamp: dossier.timestamp,
    source: dossier.source,
    eventType: dossier.eventType,
    mint: dossierMint(dossier),
    symbol: dossier.identity?.symbol || null,
    name: dossier.identity?.name || null,
    verdict: dossier.gmgnStyle?.verdict || null,
    reasons: Array.isArray(dossier.gmgnStyle?.reasons) ? dossier.gmgnStyle.reasons : [],
    tags: Array.isArray(dossier.gmgnStyle?.tags) ? dossier.gmgnStyle.tags : [],
    score: compact(dossier.gmgnStyle?.score, 2),
    curveProgress: compact(dossier.curve?.progress, 6),
    curveProgressPct: compact(dossier.curve?.progressPct, 2),
    priceSol: compact(dossier.curve?.priceSol, 15),
    recentTradeCount: compact(dossier.activity?.recentTradeCount, 0),
    buyRatio: compact(dossier.activity?.buyRatio, 4),
    sellRatio: compact(dossier.activity?.sellRatio, 4),
    recentVolumeSol: compact(dossier.activity?.recentVolumeSol, 4),
    tradeVelocityPerMin: compact(dossier.activity?.tradeVelocityPerMin, 2),
    holderProxy: compact(dossier.walletQuality?.holderProxy, 0),
    repeatedEarlyBuyerCount: compact(dossier.walletQuality?.repeatedEarlyBuyerCount, 0),
    rickMentionCount: compact(dossier.walletQuality?.rickMentionCount, 0),
    liquidityUsd: compact(dossier.market?.liquidityUsd, 2),
    volumeToLiquidity24h: compact(dossier.market?.volumeToLiquidity24h, 4),
    priceChange1hPct: compact(dossier.market?.priceChange1hPct, 2),
    priceChange6hPct: compact(dossier.market?.priceChange6hPct, 2),
    priceChange24hPct: compact(dossier.market?.priceChange24hPct, 2),
    paper: dossier.paper || null,
    continuation: dossier.continuation || null
  };
}

function identityFrom(mint, events, dossiers) {
  const dossier = dossiers.find((item) => dossierMint(item) === mint && item.identity);
  const event = events.find((item) => eventMint(item) === mint && payloadOf(item).symbol);
  const payload = event ? payloadOf(event) : {};

  return {
    mint,
    symbol: firstDefined(dossier?.identity?.symbol, payload.symbol),
    name: firstDefined(dossier?.identity?.name, payload.name),
    source: firstDefined(dossier?.identity?.source, payload.source),
    pumpFunUrl: `https://pump.fun/coin/${mint}`,
    dexscreenerUrl: firstDefined(dossier?.identity?.dexscreenerUrl)
  };
}

function buildCurveSummary(events, dossiers) {
  const samples = [];

  for (const event of events) {
    const payload = payloadOf(event);
    const curveProgress = asNumber(payload.curveProgress ?? payload.entryCurveProgress ?? payload.exitCurveProgress);
    const priceSol = asNumber(payload.priceSol ?? payload.bondingCurvePriceSol ?? payload.entryPriceSol ?? payload.exitPriceSol);
    const score = asNumber(payload.score ?? payload.entryScore);
    if (curveProgress === null && priceSol === null && score === null) continue;
    samples.push({
      timestamp: event.timestamp,
      source: eventType(event),
      curveProgress: compact(curveProgress, 6),
      priceSol: compact(priceSol, 15),
      score: compact(score, 2)
    });
  }

  for (const dossier of dossiers) {
    const curveProgress = asNumber(dossier.curve?.progress);
    const priceSol = asNumber(dossier.curve?.priceSol);
    const score = asNumber(dossier.gmgnStyle?.score);
    if (curveProgress === null && priceSol === null && score === null) continue;
    samples.push({
      timestamp: dossier.timestamp,
      source: `dossier:${dossier.source}`,
      curveProgress: compact(curveProgress, 6),
      priceSol: compact(priceSol, 15),
      score: compact(score, 2)
    });
  }

  samples.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

  const progressValues = samples.map((sample) => asNumber(sample.curveProgress)).filter((value) => value !== null);
  const scoreValues = samples.map((sample) => asNumber(sample.score)).filter((value) => value !== null);

  return {
    sampleCount: samples.length,
    first: samples[0] || null,
    last: samples[samples.length - 1] || null,
    minCurveProgress: progressValues.length ? compact(Math.min(...progressValues), 6) : null,
    maxCurveProgress: progressValues.length ? compact(Math.max(...progressValues), 6) : null,
    maxScore: scoreValues.length ? compact(Math.max(...scoreValues), 2) : null,
    sampledTimeline: downsample(samples, 16)
  };
}

function downsample(items, maxItems) {
  if (items.length <= maxItems) return items;
  const selected = [];
  for (let index = 0; index < maxItems; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (maxItems - 1));
    selected.push(items[sourceIndex]);
  }
  return selected;
}

function inferMissedBecause(events, dossiers) {
  const reasons = [];
  const tradeRejects = events
    .filter((event) => eventType(event) === 'trade.rejected')
    .map((event) => payloadOf(event).reason)
    .filter(Boolean);
  const paperSkips = dossiers
    .filter((dossier) => dossier.source === 'pre_migration_paper' && dossier.paper?.decision === 'PAPER_SKIPPED')
    .map((dossier) => dossier.paper?.reason)
    .filter(Boolean);
  const runnerSignals = events.filter((event) => eventType(event) === 'signal.generated');
  const paperEntries = events.filter((event) => eventType(event) === 'pre_migration_paper.entry');
  const paperExits = events.filter((event) => eventType(event) === 'pre_migration_paper.exit');
  const watchFlags = dossiers.filter((dossier) => dossier.source === 'pre_migration_watch');

  if (paperExits.some((event) => Number(payloadOf(event).pnlSol || 0) > 0)) {
    reasons.push('pre_migration_paper_found_profit');
  }
  if (paperEntries.length === 0 && paperSkips.length > 0) {
    reasons.push(`pre_migration_paper_skipped:${Array.from(new Set(paperSkips)).join(',')}`);
  }
  if (runnerSignals.length === 0 && watchFlags.length > 0) {
    reasons.push('watch_lane_saw_it_but_runner_lane_never_generated_signal');
  }
  if (runnerSignals.length > 0 && tradeRejects.length > 0) {
    reasons.push(`runner_signal_rejected:${Array.from(new Set(tradeRejects)).join(',')}`);
  }
  if (runnerSignals.length === 0 && watchFlags.length === 0) {
    reasons.push('no_relevant_events_found_for_mint_in_selected_logs');
  }

  return reasons;
}

function buildReport(mint, events, dossiers, files) {
  const mintEvents = events
    .filter((event) => eventMint(event) === mint)
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
  const mintDossiers = dossiers
    .filter((dossier) => dossierMint(dossier) === mint)
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));

  const timestamps = [
    ...mintEvents.map((event) => event.timestamp),
    ...mintDossiers.map((dossier) => dossier.timestamp)
  ].filter(Boolean).sort();

  const paperExits = mintEvents.filter((event) => eventType(event) === 'pre_migration_paper.exit');
  const paperPnlSol = paperExits.reduce((sum, event) => sum + Number(payloadOf(event).pnlSol || 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    files,
    identity: identityFrom(mint, mintEvents, mintDossiers),
    timeline: {
      firstSeenAt: timestamps[0] || null,
      lastSeenAt: timestamps[timestamps.length - 1] || null,
      durationSeconds: timestamps.length > 1 ? secondsBetween(timestamps[0], timestamps[timestamps.length - 1]) : null
    },
    counts: {
      telemetryEvents: mintEvents.length,
      dossiers: mintDossiers.length,
      eventTypes: countBy(mintEvents, eventType),
      dossierSources: countBy(mintDossiers, (dossier) => dossier.source),
      verdicts: countBy(mintDossiers, (dossier) => dossier.gmgnStyle?.verdict)
    },
    curve: buildCurveSummary(mintEvents, mintDossiers),
    watchLane: {
      flags: mintDossiers
        .filter((dossier) => dossier.source === 'pre_migration_watch')
        .map(summarizeDossier)
    },
    preMigrationPaper: {
      decisions: mintDossiers
        .filter((dossier) => dossier.source === 'pre_migration_paper')
        .map(summarizeDossier),
      entries: mintEvents
        .filter((event) => eventType(event) === 'pre_migration_paper.entry')
        .map(summarizeEvent),
      exits: paperExits.map(summarizeEvent),
      pnlSol: compact(paperPnlSol, 9)
    },
    runnerLane: {
      signals: mintEvents
        .filter((event) => eventType(event) === 'signal.generated')
        .map(summarizeEvent),
      safetyPassed: mintEvents
        .filter((event) => eventType(event) === 'signal.safety_passed')
        .map(summarizeEvent),
      quotePassed: mintEvents
        .filter((event) => eventType(event) === 'signal.quote_passed')
        .map(summarizeEvent),
      aiDecisions: mintEvents
        .filter((event) => {
          const serialized = JSON.stringify(event);
          return eventType(event).startsWith('ai.')
            || serialized.includes('AI_FAILURE_FALLBACK')
            || serialized.includes('AI_TIMEOUT_FALLBACK');
        })
        .map(summarizeEvent),
      rejections: mintEvents
        .filter((event) => eventType(event) === 'trade.rejected')
        .map(summarizeEvent),
      executions: mintEvents
        .filter((event) => ['signal.executed', 'trade.executed'].includes(eventType(event)))
        .map(summarizeEvent)
    },
    continuationLane: {
      dossiers: mintDossiers
        .filter((dossier) => dossier.source === 'post_migration_continuation')
        .map(summarizeDossier)
    },
    missedBecause: inferMissedBecause(mintEvents, mintDossiers),
    recentEvents: mintEvents.slice(-20).map(summarizeEvent),
    recentDossiers: mintDossiers.slice(-20).map(summarizeDossier)
  };
}

function printReport(report) {
  const id = report.identity;
  console.log('Mint Specimen Report');
  console.log('====================');
  console.log(`Mint:   ${id.mint}`);
  console.log(`Symbol: ${id.symbol || 'n/a'}`);
  console.log(`Name:   ${id.name || 'n/a'}`);
  console.log(`Window: ${report.timeline.firstSeenAt || 'n/a'} -> ${report.timeline.lastSeenAt || 'n/a'} (${report.timeline.durationSeconds ?? 'n/a'}s)`);
  console.log(`Events: ${report.counts.telemetryEvents} telemetry | ${report.counts.dossiers} dossiers`);
  console.log(`Pump:   ${id.pumpFunUrl}`);
  if (id.dexscreenerUrl) console.log(`Dex:    ${id.dexscreenerUrl}`);

  printSection('Why It Mattered / Missed');
  if (report.missedBecause.length === 0) {
    console.log('  no conclusion from selected logs');
  } else {
    for (const reason of report.missedBecause) console.log(`  ${reason}`);
  }

  printSection('Curve / Score');
  console.log(`  samples=${report.curve.sampleCount} minCurve=${pct(report.curve.minCurveProgress)} maxCurve=${pct(report.curve.maxCurveProgress)} maxScore=${report.curve.maxScore ?? 'n/a'}`);
  if (report.curve.first) {
    console.log(`  first: ${report.curve.first.timestamp} ${report.curve.first.source} curve=${pct(report.curve.first.curveProgress)} score=${report.curve.first.score ?? 'n/a'}`);
  }
  if (report.curve.last) {
    console.log(`  last:  ${report.curve.last.timestamp} ${report.curve.last.source} curve=${pct(report.curve.last.curveProgress)} score=${report.curve.last.score ?? 'n/a'}`);
  }

  printSection('Watch Lane');
  printDossierList(report.watchLane.flags);

  printSection('Pre-Migration Paper');
  console.log(`  entries=${report.preMigrationPaper.entries.length} exits=${report.preMigrationPaper.exits.length} pnl=${sol(report.preMigrationPaper.pnlSol)}`);
  if (report.preMigrationPaper.exits.length > 0) {
    for (const exit of report.preMigrationPaper.exits) {
      console.log(`  exit ${exit.symbol || exit.mint} ${exit.preset || ''}: ${exit.reason || 'n/a'} return=${pct(exit.returnPct)} pnl=${sol(exit.pnlSol)} hold=${exit.holdSeconds ?? 'n/a'}s`);
    }
  }
  const skipCounts = countBy(report.preMigrationPaper.decisions, (item) => item.paper?.reason);
  if (Object.keys(skipCounts).length > 0) {
    console.log('  skip reasons:');
    printCounts(skipCounts);
  }

  printSection('Runner Lane');
  console.log(`  signals=${report.runnerLane.signals.length} executions=${report.runnerLane.executions.length} rejections=${report.runnerLane.rejections.length} ai=${report.runnerLane.aiDecisions.length}`);
  for (const signal of report.runnerLane.signals) {
    console.log(`  signal q=${signal.qualityScore ?? 'n/a'} m=${signal.momentumScore ?? 'n/a'} rank=${signal.rankScore ?? 'n/a'}`);
  }
  for (const rejection of report.runnerLane.rejections) {
    console.log(`  reject: ${rejection.reason || 'UNKNOWN'}`);
  }
  for (const ai of report.runnerLane.aiDecisions) {
    console.log(`  ai: ${ai.reason || ai.decision || ai.type}`);
  }

  printSection('Continuation Lane');
  printDossierList(report.continuationLane.dossiers);
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printCounts(counts) {
  for (const [key, value] of Object.entries(counts)) {
    console.log(`    ${key}: ${value}`);
  }
}

function printDossierList(items) {
  if (!items.length) {
    console.log('  none');
    return;
  }

  for (const item of items) {
    console.log(`  ${item.timestamp} ${item.verdict || item.eventType || item.source} score=${item.score ?? 'n/a'} curve=${pct(item.curveProgress)}`);
    if (item.tags?.length) console.log(`    tags=${item.tags.slice(0, 10).join(',')}`);
    if (item.reasons?.length) console.log(`    reasons=${item.reasons.slice(0, 8).join(',')}`);
  }
}

function safeFileName(value) {
  return String(value || 'mint').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mint = args.mint || args._[0];
  if (!mint) {
    throw new Error('Provide a mint: npm run report:mint -- --mint <MINT>');
  }

  const logDir = resolveRepoPath(args.logDir) || DEFAULT_LOG_DIR;
  const filePairs = resolveFilePairs(args, logDir);
  const files = [];
  const events = [];
  const dossiers = [];

  for (const pair of filePairs) {
    const pairEvents = readJsonl(pair.telemetryPath);
    const pairDossiers = readJsonl(pair.dossierPath);
    events.push(...pairEvents);
    dossiers.push(...pairDossiers);
    files.push({
      telemetryPath: pair.telemetryPath,
      dossierPath: pair.dossierPath,
      telemetryEvents: pairEvents.length,
      dossiers: pairDossiers.length
    });
  }

  const report = buildReport(mint, events, dossiers, files);
  const outputPath = resolveRepoPath(args.out)
    || path.join(DEFAULT_OUTPUT_DIR, `${safeFileName(mint)}.json`);
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
    console.error(`mint-specimen-report failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  buildReport,
  readJsonl,
  resolveFilePairs
};
