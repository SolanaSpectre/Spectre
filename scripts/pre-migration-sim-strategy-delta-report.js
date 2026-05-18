const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIGNAL_QUALITY_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-signal-quality-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-sim-strategy-delta-latest.json');
// Wider than exact entry matching so nearby guard decisions on rechecks still classify the sim trade.
const DECISION_WINDOW_MS = 60000;

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line.replace(/^\uFEFF/, ''));
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

function rel(filePath) {
  return filePath ? path.relative(ROOT, filePath).replace(/\\/g, '/') : null;
}

function eventType(event) {
  return event.type || event.event || event.name || null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeMs(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function secondsBetween(start, end) {
  const left = timeMs(start);
  const right = timeMs(end);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return compact((right - left) / 1000, 3);
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function summarizePnl(rows) {
  const closed = rows.filter((row) => Number.isFinite(Number(row.pnlSol)));
  const wins = closed.filter((row) => Number(row.pnlSol) > 0);
  const losses = closed.filter((row) => Number(row.pnlSol) < 0);
  const totalPnlSol = closed.reduce((sum, row) => sum + Number(row.pnlSol || 0), 0);
  return {
    trades: rows.length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? compact(wins.length / closed.length, 4) : null,
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlSol: closed.length ? compact(totalPnlSol / closed.length, 9) : null
  };
}

function collectDecisions(events) {
  const byMint = new Map();
  for (const event of events) {
    if (eventType(event) !== 'pre_migration_paper.decision') continue;
    const payload = payloadOf(event);
    const mint = mintOf(payload);
    if (!mint) continue;
    const rows = byMint.get(mint) || [];
    rows.push({
      timestamp: event.timestamp || payload.timestamp || null,
      preset: payload.preset || null,
      decision: payload.decision || null,
      reason: payload.reason || null,
      shadowPresetWouldEnter: payload.shadowPresetWouldEnter ?? null,
      score: asNumber(payload.score),
      curveProgress: asNumber(payload.curveProgress)
    });
    byMint.set(mint, rows);
  }
  return byMint;
}

function nearestDecisions(decisionsByMint, mint, anchorAt) {
  const anchorMs = timeMs(anchorAt);
  if (!mint || !Number.isFinite(anchorMs)) return [];
  return (decisionsByMint.get(mint) || [])
    .filter((decision) => {
      const delta = timeMs(decision.timestamp) - anchorMs;
      return Number.isFinite(delta) && Math.abs(delta) <= DECISION_WINDOW_MS;
    })
    .sort((a, b) => Math.abs(timeMs(a.timestamp) - anchorMs) - Math.abs(timeMs(b.timestamp) - anchorMs))
    .map((decision) => ({
      ...decision,
      offsetSeconds: secondsBetween(anchorAt, decision.timestamp)
    }));
}

function loadDecisionMaps(telemetryPaths) {
  const maps = new Map();
  for (const telemetryPath of telemetryPaths) {
    if (!telemetryPath || maps.has(telemetryPath)) continue;
    maps.set(telemetryPath, collectDecisions(readJsonl(telemetryPath)));
  }
  return maps;
}

function compactTrade(trade, decisions) {
  const skipped = decisions.filter((decision) => decision.decision === 'PAPER_SKIPPED');
  const entered = decisions.filter((decision) => decision.decision === 'PAPER_ENTRY');
  const reasons = Array.from(new Set(skipped.map((decision) => decision.reason).filter(Boolean))).sort();
  const presets = Array.from(new Set(decisions.map((decision) => decision.preset).filter(Boolean))).sort();
  const comparable = entered.length > 0 || skipped.length === 0;
  const classification = entered.length > 0
    ? 'runtime_entered'
    : skipped.length > 0
      ? 'runtime_rejected'
      : 'no_runtime_decision';

  return {
    telemetryPath: rel(trade.telemetryPath),
    telemetryFile: trade.telemetryFile || path.basename(trade.telemetryPath || ''),
    mint: trade.mint,
    symbol: trade.symbol || null,
    simEntryAt: trade.entryAt,
    simExitReason: trade.exitReason || null,
    pnlSol: asNumber(trade.pnlSol),
    score: asNumber(trade.score),
    curveProgress: asNumber(trade.curveProgress),
    runtimeComparable: comparable,
    classification,
    runtimeRejectReasons: reasons,
    runtimeDecisionPresets: presets,
    nearbyDecisions: decisions
  };
}

function buildReport() {
  const signalQuality = readJson(SIGNAL_QUALITY_PATH);
  const trades = Array.isArray(signalQuality.trades) ? signalQuality.trades : [];
  const telemetryPaths = [...new Set(trades.map((trade) => trade.telemetryPath).filter(Boolean))];
  const decisionMaps = loadDecisionMaps(telemetryPaths);
  const rows = trades.map((trade) => {
    const decisionMap = decisionMaps.get(trade.telemetryPath) || new Map();
    return compactTrade(trade, nearestDecisions(decisionMap, trade.mint, trade.entryAt));
  });
  const runtimeRejected = rows.filter((row) => row.classification === 'runtime_rejected');
  const runtimeEntered = rows.filter((row) => row.classification === 'runtime_entered');
  const noRuntimeDecision = rows.filter((row) => row.classification === 'no_runtime_decision');
  const comparableRows = rows.filter((row) => row.runtimeComparable);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      signalQualityPath: rel(SIGNAL_QUALITY_PATH),
      telemetryPaths: telemetryPaths.map(rel)
    },
    summary: {
      simulatedTrades: rows.length,
      runtimeComparableTrades: comparableRows.length,
      runtimeRejectedTrades: runtimeRejected.length,
      runtimeEnteredTrades: runtimeEntered.length,
      noRuntimeDecisionTrades: noRuntimeDecision.length,
      allSimulatedPnl: summarizePnl(rows),
      comparableSimulatedPnl: summarizePnl(comparableRows),
      runtimeRejectedSimulatedPnl: summarizePnl(runtimeRejected),
      rejectReasonCounts: countBy(
        runtimeRejected.flatMap((row) => row.runtimeRejectReasons.map((reason) => ({ reason }))),
        (row) => row.reason
      ),
      classificationCounts: countBy(rows, (row) => row.classification),
      interpretation: runtimeRejected.length
        ? 'rolling sim includes trades that same-window runtime decisions rejected; use comparableSimulatedPnl before treating sim results as representative of live paper behavior'
        : 'rolling sim currently contains no trades that same-window runtime decisions rejected'
    },
    runtimeRejectedTrades: runtimeRejected,
    runtimeComparableTrades: comparableRows,
    noRuntimeDecisionTrades: noRuntimeDecision,
    topRuntimeRejectedWinners: runtimeRejected
      .filter((row) => Number(row.pnlSol) > 0)
      .sort((a, b) => Number(b.pnlSol) - Number(a.pnlSol))
      .slice(0, 10),
    topRuntimeRejectedLosers: runtimeRejected
      .filter((row) => Number(row.pnlSol) < 0)
      .sort((a, b) => Number(a.pnlSol) - Number(b.pnlSol))
      .slice(0, 10),
    note: 'Report-only sim strategy delta diagnostic. Uses same-window runtime pre_migration_paper.decision telemetry to separate rolling simulated trades into runtime-comparable and runtime-rejected groups. Does not change thresholds, entries, exits, scoring, AI review, or live behavior.'
  };
}

function main() {
  const report = buildReport();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
