const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'reports', 'latest-run-summary.txt');

const FILES = {
  battlefield: 'data/reports/run-battlefield-latest.json',
  outcomeLedger: 'data/reports/outcome-ledger-latest.json',
  falseNegatives: 'data/watchlists/outcome-ledger-false-negative-latest.json',
  preMigrationOutcomes: 'data/reports/pre-migration-outcomes-latest.json',
  preMigrationPaper: 'data/reports/pre-migration-paper-sim-latest.json',
  signalQuality: 'data/reports/pre-migration-signal-quality-latest.json',
  learning: 'data/reports/learning-orchestrator-latest.json',
  continuationPaper: 'data/reports/continuation-paper-latest.json',
  noPriorRecovery: 'data/reports/no-prior-curve-recovery-latest.json'
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function repoPath(relativePath) {
  return path.join(REPO_ROOT, relativePath);
}

function readJson(relativePath) {
  const filePath = repoPath(relativePath);
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, path: relativePath, error: 'missing file', data: null };
    }
    return {
      ok: true,
      path: relativePath,
      error: null,
      data: JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''))
    };
  } catch (error) {
    return { ok: false, path: relativePath, error: error.message, data: null };
  }
}

function get(obj, paths, fallback = null) {
  const candidates = Array.isArray(paths) ? paths : [paths];
  for (const candidate of candidates) {
    const parts = String(candidate).split('.');
    let current = obj;
    let found = true;
    for (const part of parts) {
      if (current && Object.prototype.hasOwnProperty.call(current, part)) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found && current !== undefined && current !== null) return current;
  }
  return fallback;
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number(n.toFixed(digits)).toString();
}

function pct(value, digits = 1) {
  if (value === null || value === undefined || value === '') return 'n/a';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return `${Number((n * 100).toFixed(digits))}%`;
}

function sol(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)} SOL`;
}

function money(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}$${n.toFixed(digits)}`;
}

function compactValue(value) {
  if (value === null || value === undefined || value === '') return 'n/a';
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (typeof value !== 'object') return String(value);
  const parts = Object.entries(value)
    .filter(([, child]) => child === null || typeof child !== 'object')
    .slice(0, 5)
    .map(([key, child]) => `${key}=${child}`);
  return parts.length ? parts.join(', ') : `${Object.keys(value).length} field(s)`;
}

function topArray(value, limit = 5) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function objectLines(obj, limit = 12) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return ['none'];
  const entries = Object.entries(obj)
    .sort((a, b) => number(b[1], 0) - number(a[1], 0))
    .slice(0, limit);
  return entries.length ? entries.map(([k, v]) => `${k}: ${compactValue(v)}`) : ['none'];
}

function findArrayDeep(obj, keyHints = []) {
  const queue = [{ value: obj, path: '' }];
  const matches = [];
  while (queue.length) {
    const { value, path: p } = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      if (value.length && keyHints.some((hint) => p.toLowerCase().includes(hint.toLowerCase()))) {
        matches.push({ path: p, value });
      }
      value.slice(0, 20).forEach((item, index) => queue.push({ value: item, path: `${p}[${index}]` }));
      continue;
    }
    Object.entries(value).forEach(([key, child]) => queue.push({ value: child, path: p ? `${p}.${key}` : key }));
  }
  return matches;
}

function candidateLabel(item = {}) {
  const symbol = item.symbol || item.tokenSymbol || item.name || item.token?.symbol || 'UNKNOWN';
  const mint = item.mint || item.tokenMint || item.address || item.token?.mint || item.id || '';
  return mint ? `${symbol} ${mint}` : symbol;
}

function summarizeFalseNegative(item = {}) {
  const label = candidateLabel(item);
  const outcome = item.outcome || item.classification || item.status || item.result || '';
  const score = item.score ?? item.maxScore ?? item.bestScore ?? item.falseNegativeScore ?? item.fnScore;
  const curve = item.curveProgress ?? item.maxCurveProgress ?? item.bestCurveProgress ?? item.curve;
  const reason = item.reason || item.reasons || item.skipReasons || item.rejectReasons || '';
  const reasonText = Array.isArray(reason) ? reason.join(',') : typeof reason === 'object' ? JSON.stringify(reason) : String(reason || '');
  return `${label}${outcome ? ` | ${outcome}` : ''}${score !== undefined ? ` | score=${fmt(score)}` : ''}${curve !== undefined ? ` | curve=${fmt(curve, 4)}` : ''}${reasonText ? ` | ${reasonText.slice(0, 160)}` : ''}`;
}

function summarizeRecoveryCandidate(item = {}) {
  const label = candidateLabel(item);
  const outcome = item.outcome || item.classification || item.status || '';
  const priority = item.priority ?? item.falseNegativePriority;
  const score = item.maxScore ?? item.score;
  const curve = item.maxCurveProgress ?? item.curveProgress;
  const vol = item.maxRecentVolumeSol ?? item.recentVolumeSol;
  const vel = item.maxTradeVelocityPerMin ?? item.tradeVelocityPerMin;
  const noPrior = item.noPriorSkips ?? item.paperSkips?.NO_PRIOR_CURVE_PROGRESS;
  const failures = Array.isArray(item.failures) && item.failures.length ? ` | failures=${item.failures.join(',')}` : '';
  return `${label}${outcome ? ` | ${outcome}` : ''}${priority !== undefined ? ` | priority=${fmt(priority)}` : ''}${score !== undefined ? ` | score=${fmt(score)}` : ''}${curve !== undefined ? ` | curve=${fmt(curve, 4)}` : ''}${vol !== undefined ? ` | vol=${fmt(vol, 2)}` : ''}${vel !== undefined ? ` | vel=${fmt(vel, 2)}` : ''}${noPrior !== undefined ? ` | noPrior=${noPrior}` : ''}${failures}`;
}

function summarizeRunnerReject(item = {}) {
  const label = item.symbol || item.mint || 'UNKNOWN';
  const details = [
    item.reason ? `reason=${item.reason}` : null,
    item.source ? `source=${item.source}` : null,
    item.momentumScore !== null && item.momentumScore !== undefined ? `momentum=${fmt(item.momentumScore, 4)}` : null,
    item.qualityScore !== null && item.qualityScore !== undefined ? `quality=${fmt(item.qualityScore, 4)}` : null,
    item.rankScore !== null && item.rankScore !== undefined ? `rank=${fmt(item.rankScore, 4)}` : null,
    item.pumpFailureReason ? `pumpFailure=${item.pumpFailureReason}` : null
  ].filter(Boolean);
  return `${label}${details.length ? ` | ${details.join(' | ')}` : ''}`;
}

function summarizeLesson(lesson = {}) {
  if (!lesson || typeof lesson !== 'object') return String(lesson || '');
  const parts = [];
  if (lesson.type) parts.push(lesson.type);
  if (lesson.severity) parts.push(`severity=${lesson.severity}`);
  if (lesson.text) parts.push(lesson.text);
  if (lesson.evidence && typeof lesson.evidence === 'object' && !Array.isArray(lesson.evidence)) {
    parts.push(`evidence=${compactValue(lesson.evidence)}`);
  } else if (Array.isArray(lesson.evidence)) {
    parts.push(`evidence=${lesson.evidence.length} item(s)`);
  }
  return parts.join(' | ');
}

function collectSimpleRuntimeEvidence() {
  const evidence = [];
  const paths = [path.join(REPO_ROOT, 'run-logs'), path.join(REPO_ROOT, 'data', 'outcomes')];
  const patterns = ['Simple runtime AI', 'SIMPLE_RUNTIME_AI', 'llama3.2'];

  for (const base of paths) {
    if (!fs.existsSync(base)) continue;
    const files = fs.readdirSync(base)
      .filter((name) => name.endsWith('.jsonl') || name.endsWith('.log') || name.endsWith('.txt'))
      .map((name) => path.join(base, name));
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          evidence.push(path.relative(REPO_ROOT, file));
          break;
        }
      }
    }
  }

  return Array.from(new Set(evidence));
}

function buildAiReachability(battlefield = {}) {
  const runner = battlefield.runnerLane || {};
  const eventCounts = battlefield.eventCounts || {};
  const diag = runner.scalperDiagnostics || {};
  const generatedSignals = number(runner.generatedSignals ?? diag.generatedSignals, 0);
  const executedSignals = number(runner.executedSignals ?? diag.executedSignals, 0);
  const rejectedTrades = number(runner.rejectedTrades, 0);
  const quoteRejects = number(diag.quoteRejects, 0);
  const aiRejects = number(diag.aiRejects, 0);
  const aiDecisionEvents = number(eventCounts['signal.ai_decision'], 0)
    + number(eventCounts['ai.veto'], 0)
    + number(eventCounts['ai.caution'], 0);
  const aiTimeoutFallbacks = Array.isArray(runner.aiTimeoutFallback) ? runner.aiTimeoutFallback.length : 0;

  let interpretation = 'AI path status is inconclusive from the available report fields.';
  if (generatedSignals === 0) {
    interpretation = 'No runner/scalper signals were generated, so no real candidate reached runtime AI review.';
  } else if (aiDecisionEvents === 0 && quoteRejects > 0) {
    interpretation = 'Signals were generated but stopped at quote/quality handling before AI review.';
  } else if (aiDecisionEvents > 0) {
    interpretation = 'At least one real candidate reached AI decision handling.';
  }

  return {
    generatedSignals,
    executedSignals,
    rejectedTrades,
    quoteRejects,
    aiRejects,
    aiDecisionEvents,
    aiTimeoutFallbacks,
    interpretation
  };
}

function buildSummary(docs) {
  const battlefield = docs.battlefield.data || {};
  const ledger = docs.outcomeLedger.data || {};
  const falseNeg = docs.falseNegatives.data || {};
  const preOutcomes = docs.preMigrationOutcomes.data || {};
  const paper = docs.preMigrationPaper.data || {};
  const signal = docs.signalQuality.data || {};
  const learning = docs.learning.data || {};
  const continuation = docs.continuationPaper.data || {};
  const noPriorRecovery = docs.noPriorRecovery.data || {};
  const lines = [];

  const generatedAt = new Date().toISOString();
  lines.push('Latest Run Summary');
  lines.push('==================');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');

  const missing = Object.values(docs).filter((doc) => !doc.ok);
  if (missing.length) {
    lines.push('Missing / unreadable inputs');
    lines.push('---------------------------');
    missing.forEach((doc) => lines.push(`- ${doc.path}: ${doc.error}`));
    lines.push('');
  }

  const duration = get(battlefield, [
    'session.activeDurationMinutes',
    'session.durationMinutes',
    'window.activeTelemetryMinutes',
    'durationMinutes',
    'runDurationMinutes',
    'summary.durationMinutes',
    'session.activeTelemetryMinutes'
  ], get(preOutcomes, ['runDurationMinutes', 'durationMinutes'], null));
  const events = get(battlefield, ['session.eventCount', 'events', 'eventCount', 'summary.events'], null);
  const dossiers = get(battlefield, ['session.dossierCount', 'dossierCount', 'summary.dossiers'], null);
  const paperEntries = get(battlefield, [
    'preMigrationPaper.entries',
    'pre_migration_paper.entries',
    'paper.entries',
    'summary.paperEntries'
  ], get(paper, ['actual.entries', 'actualPaper.entries', 'entries'], null));
  const paperExits = get(battlefield, [
    'preMigrationPaper.exits',
    'pre_migration_paper.exits',
    'paper.exits',
    'summary.paperExits'
  ], get(paper, ['actual.exits', 'actualPaper.exits', 'exits'], null));
  const paperPnl = get(battlefield, [
    'preMigrationPaper.pnlSol',
    'pre_migration_paper.pnlSol',
    'paper.pnlSol',
    'summary.paperPnlSol'
  ], null);
  const aiEvidence = collectSimpleRuntimeEvidence();
  const aiReachability = buildAiReachability(battlefield);

  lines.push('1. Run Summary');
  lines.push('--------------');
  lines.push(`- Duration: ${duration === null ? 'n/a' : `${fmt(duration)} min`}`);
  lines.push(`- Events: ${events ?? 'n/a'}`);
  lines.push(`- Dossiers: ${dossiers ?? 'n/a'}`);
  lines.push(`- Pre-migration paper entries/exits: ${paperEntries ?? 'n/a'} / ${paperExits ?? 'n/a'}`);
  lines.push(`- Pre-migration paper PnL: ${paperPnl === null ? 'n/a' : sol(paperPnl)}`);
  lines.push(`- Simple Runtime AI evidence in logs: ${aiEvidence.length ? `found in ${aiEvidence.join(', ')}` : 'not found in run logs/outcome ledger'}`);
  lines.push('- AI path reachability:');
  lines.push(`  - runner/scalper signals generated/executed: ${aiReachability.generatedSignals} / ${aiReachability.executedSignals}`);
  lines.push(`  - trade rejects before signal execution: ${aiReachability.rejectedTrades}`);
  lines.push(`  - AI decision events / AI rejects / timeout fallbacks: ${aiReachability.aiDecisionEvents} / ${aiReachability.aiRejects} / ${aiReachability.aiTimeoutFallbacks}`);
  lines.push(`  - interpretation: ${aiReachability.interpretation}`);
  lines.push('');

  const runnerNearMiss = battlefield.runnerLane?.nearMissDiagnostic || {};
  lines.push('2. Runner / AI Near-Miss Diagnostic');
  lines.push('-----------------------------------');
  lines.push(`- Posture: ${runnerNearMiss.posture || 'n/a'}`);
  lines.push(`- Interpretation: ${runnerNearMiss.interpretation || aiReachability.interpretation}`);
  lines.push('- Rejection reasons:');
  objectLines(runnerNearMiss.rejectionReasons || battlefield.runnerLane?.rejectionReasons, 8)
    .forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Rejection sources:');
  objectLines(runnerNearMiss.rejectionSources || battlefield.runnerLane?.rejectionSources, 8)
    .forEach((line) => lines.push(`  - ${line}`));
  const closestRunnerRejects = topArray(runnerNearMiss.closestRejected, 5);
  lines.push('- Closest rejected candidates:');
  if (closestRunnerRejects.length) {
    closestRunnerRejects.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRunnerReject(item)}`));
  } else {
    lines.push('  - none captured');
  }
  lines.push('');

  const watchFlags = get(battlefield, [
    'watchLane.uniqueCandidates',
    'watch.uniqueCandidates',
    'preMigrationWatch.flags',
    'summary.watchFlags'
  ], get(preOutcomes, ['flags.unique', 'uniqueFlags', 'flags'], null));
  const confirmedWatch = get(battlefield, [
    'preMigrationWatch.confirmed',
    'watch.confirmed',
    'watchLane.confirmed'
  ], get(preOutcomes, ['confirmed', 'watchConfirmed'], null));
  const outcomeCounts = get(ledger, ['summary.outcomeCounts', 'outcomeCounts'], get(preOutcomes, ['summary.outcomeCounts', 'outcomeCounts', 'outcomes'], {}));
  const skipReasons = get(battlefield, [
    'preMigrationPaper.skipReasons',
    'pre_migration_paper.skipReasons',
    'skipReasons'
  ], get(paper, ['skipReasons'], {}));
  const topWatch = topArray(get(battlefield, ['watchLane.topWatch', 'watch.top', 'topWatch'], []), 8);
  const falseNegArray = Array.isArray(falseNeg)
    ? falseNeg
    : topArray(get(falseNeg, ['candidates', 'falseNegatives', 'watchlist', 'items', 'mints'], []), 10);
  const ledgerFalseNegArray = topArray(get(ledger, ['falseNegativeCandidates', 'falseNegatives', 'topFalseNegatives'], []), 10);
  const falseNegatives = falseNegArray.length ? falseNegArray : ledgerFalseNegArray;

  lines.push('3. Pre-Migration Findings');
  lines.push('-------------------------');
  lines.push(`- Watch flags / unique candidates: ${watchFlags ?? 'n/a'}`);
  lines.push(`- Confirmed watch count: ${confirmedWatch ?? 'n/a'}`);
  lines.push('- Outcomes:');
  objectLines(outcomeCounts).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top skip reasons:');
  objectLines(skipReasons).forEach((line) => lines.push(`  - ${line}`));
  lines.push('- Top false negatives / missed runners:');
  (falseNegatives.length ? falseNegatives : []).slice(0, 8).forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  if (!falseNegatives.length) lines.push('  - none found in false-negative watchlist/report');
  if (topWatch.length) {
    lines.push('- Top watch candidates:');
    topWatch.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  lines.push('');

  const recoverySummary = noPriorRecovery.summary || {};
  const recoveryCandidates = topArray(noPriorRecovery.recovery, 5);
  const watchOnlyCandidates = topArray(noPriorRecovery.watchOnly, 3);

  lines.push('4. NO_PRIOR Recovery Diagnostic');
  lines.push('-------------------------------');
  lines.push(`- Source candidates: ${recoverySummary.sourceCount ?? 'n/a'}`);
  lines.push(`- Recovery candidates: ${recoverySummary.recoveryCount ?? 'n/a'}`);
  lines.push(`- Watch-only: ${recoverySummary.watchOnlyCount ?? 'n/a'}`);
  lines.push('- Top recovery candidates:');
  if (recoveryCandidates.length) {
    recoveryCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRecoveryCandidate(item)}`));
  } else {
    lines.push('  - none');
  }
  lines.push('- Top failure counts:');
  objectLines(recoverySummary.failureCounts, 8).forEach((line) => lines.push(`  - ${line}`));
  if (watchOnlyCandidates.length) {
    lines.push('- Watch-only examples:');
    watchOnlyCandidates.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeRecoveryCandidate(item)}`));
  }
  lines.push('');

  const paperSummary = paper.summary || {};
  const simTrades = Object.prototype.hasOwnProperty.call(paperSummary, 'simulatedTrades')
    ? paperSummary.simulatedTrades
    : get(paper, ['trades', 'simulatedTrades', 'summary.trades'], get(signal, ['summary.trades', 'trades'], null));
  const simWins = Object.prototype.hasOwnProperty.call(paperSummary, 'wins')
    ? paperSummary.wins
    : get(paper, ['wins'], get(signal, ['summary.wins', 'wins'], null));
  const simLosses = Object.prototype.hasOwnProperty.call(paperSummary, 'losses')
    ? paperSummary.losses
    : get(paper, ['losses'], get(signal, ['summary.losses', 'losses'], null));
  const simWinRate = Object.prototype.hasOwnProperty.call(paperSummary, 'winRate')
    ? paperSummary.winRate
    : get(paper, ['winRate'], get(signal, ['summary.winRate', 'winRate'], null));
  const simPnl = Object.prototype.hasOwnProperty.call(paperSummary, 'totalPnlSol')
    ? paperSummary.totalPnlSol
    : get(paper, ['summary.pnlSol', 'pnlSol', 'pnl'], get(signal, ['summary.pnlSol', 'pnlSol', 'pnl'], null));
  const topTrades = topArray(get(paper, ['topTrades', 'tradesDetail', 'tradesList'], []), 5);
  const topWinners = topArray(get(signal, ['topWinners', 'winners'], []), 3);
  const topLosers = topArray(get(signal, ['topLosers', 'losers'], []), 3);

  lines.push('5. Paper Sim Findings');
  lines.push('---------------------');
  lines.push(`- Simulated trades: ${simTrades ?? 'n/a'}`);
  lines.push(`- Wins/losses: ${simWins ?? 'n/a'} / ${simLosses ?? 'n/a'}`);
  lines.push(`- Win rate: ${simWinRate === null ? 'n/a' : pct(simWinRate)}`);
  lines.push(`- PnL: ${simPnl === null ? 'n/a' : sol(simPnl, 6)}`);
  if (topTrades.length) {
    lines.push('- Top simulated trades:');
    topTrades.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (topWinners.length) {
    lines.push('- Top winners:');
    topWinners.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (topLosers.length) {
    lines.push('- Top losers:');
    topLosers.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  lines.push('');

  const opened = get(continuation, ['summary.openedThisRun', 'openedThisRun', 'summary.opened'], null);
  const closed = get(continuation, ['summary.closedThisRun', 'closedThisRun', 'summary.closed'], null);
  const openPositions = get(continuation, ['summary.openPositions', 'openPositions', 'open'], null);
  const openPnlSol = get(continuation, ['summary.openPnlSol', 'openPnlSol', 'openPnlSOL', 'openPnl.sol'], null);
  const openPnlUsd = get(continuation, ['summary.openPnlUsd', 'openPnlUsd', 'openPnlUSD', 'openPnl.usd'], null);
  const continuationOpened = topArray(get(continuation, ['opened', 'openedPositions', 'positionsOpened'], []), 8);
  const continuationSkipped = topArray(get(continuation, ['skippedIneligible', 'skipped', 'ineligible'], []), 8);

  lines.push('6. Continuation Findings');
  lines.push('------------------------');
  lines.push(`- Opened this run: ${opened ?? 'n/a'}`);
  lines.push(`- Closed this run: ${closed ?? 'n/a'}`);
  lines.push(`- Open positions: ${Array.isArray(openPositions) ? openPositions.length : openPositions ?? 'n/a'}`);
  lines.push(`- Open PnL: ${openPnlSol === null ? 'n/a' : sol(openPnlSol, 6)}${openPnlUsd === null ? '' : ` (${money(openPnlUsd, 2)})`}`);
  if (continuationOpened.length) {
    lines.push('- Opened positions:');
    continuationOpened.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  if (continuationSkipped.length) {
    lines.push('- Skipped / ineligible examples:');
    continuationSkipped.forEach((item, index) => lines.push(`  ${index + 1}. ${summarizeFalseNegative(item)}`));
  }
  lines.push('');

  const regime = get(learning, ['regime', 'summary.regime'], null);
  const posture = get(learning, ['recommendations.recommendedPosture', 'recommendedPosture', 'posture', 'summary.recommendedPosture'], null);
  const laneScores = get(learning, ['laneScores'], null);
  const laneRecs = get(learning, ['recommendations.laneRecommendations', 'laneRecommendations', 'recommendations.lanes'], {});
  const lessons = topArray(get(learning, ['lessons'], []), 8);
  const proposals = topArray(get(learning, ['proposals', 'recommendations.proposals'], []), 8);

  lines.push('7. Learning Orchestrator');
  lines.push('------------------------');
  lines.push(`- Regime: ${compactValue(regime)}`);
  lines.push(`- Recommended posture: ${compactValue(posture)}`);
  if (laneScores && typeof laneScores === 'object') {
    lines.push('- Lane scores:');
    objectLines(laneScores).forEach((line) => lines.push(`  - ${line}`));
  }
  if (Array.isArray(laneRecs) && laneRecs.length) {
    lines.push('- Lane recommendations:');
    laneRecs.forEach((rec) => {
      const lane = rec.lane || 'unknown';
      const recPosture = rec.posture || compactValue(rec);
      const rationale = rec.rationale ? ` | ${rec.rationale}` : '';
      lines.push(`  - ${lane}: ${recPosture}${rationale}`);
    });
  } else if (laneRecs && typeof laneRecs === 'object') {
    lines.push('- Lane recommendations:');
    Object.entries(laneRecs).forEach(([lane, rec]) => lines.push(`  - ${lane}: ${compactValue(rec)}`));
  }
  if (lessons.length) {
    lines.push('- Lessons:');
    lessons.forEach((lesson) => lines.push(`  - ${summarizeLesson(lesson)}`));
  }
  if (proposals.length) {
    lines.push('- Proposals from learning report:');
    proposals.forEach((proposal) => lines.push(`  - ${typeof proposal === 'object' ? JSON.stringify(proposal) : proposal}`));
  }
  lines.push('');

  const noPriorCount = number(skipReasons?.NO_PRIOR_CURVE_PROGRESS, null);
  const curveNotAdvancingCount = number(skipReasons?.CURVE_NOT_ADVANCING, null);
  const hasFalseNegatives = falseNegatives.length > 0;
  const continuationOpenNegative = openPnlSol !== null && number(openPnlSol) < 0;
  const simNegative = simPnl !== null && number(simPnl) < 0;
  const simpleRuntimeFired = aiEvidence.length > 0 || aiReachability.aiDecisionEvents > 0;

  lines.push('8. Evidence-backed Recommendations');
  lines.push('-----------------------------------');
  lines.push('1. Keep pre-migration thresholds unchanged for the next validation run.');
  lines.push(`   Evidence: false negatives=${falseNegatives.length}; NO_PRIOR_CURVE_PROGRESS=${noPriorCount ?? 'n/a'}; CURVE_NOT_ADVANCING=${curveNotAdvancingCount ?? 'n/a'}; sim PnL=${simPnl === null ? 'n/a' : sol(simPnl, 6)}.`);
  lines.push('   Risk of changing now: overfitting to one short window and admitting weak first-curve setups.');
  lines.push(`   Status: ${hasFalseNegatives ? 'collect more data before loosening' : 'maintain until stronger false-negative sample appears'}.`);
  lines.push('');

  lines.push('2. Track false negatives explicitly, especially high-score watch candidates that approach 85% migration.');
  lines.push(`   Evidence: false-negative watchlist count=${falseNegatives.length}; outcome distribution=${compactValue(outcomeCounts)}.`);
  lines.push('   Risk of changing now: low if report-only; high if converted directly into entries.');
  lines.push('   Status: implement as analysis/reporting discipline, not entry logic loosening.');
  lines.push('');

  lines.push('3. Keep continuation paper selective and block high-churn / late vertical chase candidates.');
  lines.push(`   Evidence: continuation opened=${opened ?? 'n/a'}, open PnL=${openPnlSol === null ? 'n/a' : sol(openPnlSol, 6)}, skipped/ineligible examples=${continuationSkipped.length}.`);
  lines.push('   Risk of changing now: continuation can bleed quickly in churn regimes.');
  lines.push(`   Status: ${continuationOpenNegative ? 'tighten/maintain caution' : 'maintain current selective bridge'}.`);
  lines.push('');

  lines.push('4. Validate Simple Runtime AI in real candidate flow, not only synthetic smoke.');
  lines.push(`   Evidence: Simple Runtime AI evidence in latest run logs=${simpleRuntimeFired ? 'present' : 'absent'}; ${aiReachability.interpretation}`);
  lines.push('   Risk of changing now: treating AI as validated for live decisions before enough real review samples.');
  lines.push('   Status: keep paper-only and monitor for real Simple runtime AI review lines.');
  lines.push('');

  lines.push('5. Prefer deterministic summaries over Cline report interpretation until Cline file-path behavior is reliable.');
  lines.push('   Evidence: this script reads fixed report paths and produces stable fields without asking for missing optional files.');
  lines.push('   Risk of changing now: low; improves repeatability and reduces model drift.');
  lines.push('   Status: use this script after every run before asking any model for review.');
  lines.push('');

  lines.push('Files read');
  lines.push('----------');
  Object.values(docs).forEach((doc) => lines.push(`- ${doc.ok ? 'OK' : 'ERR'} ${doc.path}${doc.error ? ` (${doc.error})` : ''}`));
  lines.push('');

  return lines.join('\n');
}

function writeOutput(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = args.output ? path.resolve(REPO_ROOT, args.output) : DEFAULT_OUTPUT;
  const docs = Object.fromEntries(
    Object.entries(FILES).map(([key, relativePath]) => [key, readJson(relativePath)])
  );
  const summary = buildSummary(docs);
  writeOutput(output, summary);
  console.log(summary);
  console.log(`Wrote summary: ${output}`);
}

main();
