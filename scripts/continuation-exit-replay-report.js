const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE_PATH = path.join(ROOT, 'data', 'continuation-paper', 'state.json');
const CONTINUATION_REPORT_PATH = path.join(ROOT, 'data', 'reports', 'continuation-paper-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'continuation-exit-replay-latest.json');

const SCENARIOS = [
  {
    name: 'current_config_replay',
    description: 'Replay each position with its stored continuation paper config.'
  },
  {
    name: 'tight_stop_8pct',
    description: 'Same config, but stop loss tightened to 8%.',
    overrides: { stopLossPct: 0.08 }
  },
  {
    name: 'max_hold_1h',
    description: 'Same config, but max hold shortened to 1 hour.',
    overrides: { maxHoldHours: 1 }
  },
  {
    name: 'max_hold_2h',
    description: 'Same config, but max hold shortened to 2 hours.',
    overrides: { maxHoldHours: 2 }
  },
  {
    name: 'fast_fade_3m',
    description: 'Report-only fast-fade replay: close at the first observed sample after 3 minutes if no earlier TP/SL/trailing exit fires.',
    fastFadeMinutes: 3,
    fastFadeReason: 'FAST_FADE_3M'
  },
  {
    name: 'fast_fade_5m',
    description: 'Report-only fast-fade replay: close at the first observed sample after 5 minutes if no earlier TP/SL/trailing exit fires.',
    fastFadeMinutes: 5,
    fastFadeReason: 'FAST_FADE_5M'
  },
  {
    name: 'fast_fade_10m',
    description: 'Report-only fast-fade replay: close at the first observed sample after 10 minutes if no earlier TP/SL/trailing exit fires.',
    fastFadeMinutes: 10,
    fastFadeReason: 'FAST_FADE_10M'
  },
  {
    name: 'trailing_stop_5pct_new_slippage',
    description: 'Report-only spike protection replay using new paper slippage and a 5% trailing stop from observed peak.',
    overrides: { entrySlippagePct: 0.01, exitSlippagePct: 0.015, trailingStopPct: 0.05 },
    useRawEntryPrice: true
  },
  {
    name: 'staged_exit_50_40_10',
    description: 'Report-only staged exit replay: 50% at first sample after 3m, 40% after 10m, 10% follows current exit logic.',
    stagedExit: true,
    stages: [
      { fraction: 0.5, afterMinutes: 3, reason: 'STAGED_EXIT_50_AT_3M' },
      { fraction: 0.4, afterMinutes: 10, reason: 'STAGED_EXIT_40_AT_10M' }
    ],
    runnerFraction: 0.1,
    overrides: { entrySlippagePct: 0.01, exitSlippagePct: 0.015 },
    useRawEntryPrice: true
  },
  {
    name: 'reduced_exit_slippage_2pct',
    description: 'Same config, but exit slippage reduced from stored value to 2%.',
    overrides: { exitSlippagePct: 0.02 }
  },
  {
    name: 'reduced_paper_slippage_1_1p5pct',
    description: 'Same config, but continuation paper slippage set to the new default 1% entry / 1.5% exit.',
    overrides: { entrySlippagePct: 0.01, exitSlippagePct: 0.015 },
    useRawEntryPrice: true
  },
  {
    name: 'no_slippage_reference',
    description: 'Reference-only replay with entry and exit slippage removed.',
    overrides: { entrySlippagePct: 0, exitSlippagePct: 0 },
    useRawEntryPrice: true
  }
];

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    return { error: error.message };
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function rel(filePath) {
  return path.relative(ROOT, filePath).replace(/\\/g, '/');
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : null;
}

function hoursBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3600000;
}

function minutesBetween(startIso, endIso) {
  const hours = hoursBetween(startIso, endIso);
  return Number.isFinite(hours) ? hours * 60 : null;
}

function eventSamples(position) {
  return (Array.isArray(position.timeline) ? position.timeline : [])
    .filter((event) => ['OPEN', 'UPDATE'].includes(event.event) && event.timestamp)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function configFor(position, scenario) {
  return {
    ...(position.config || {}),
    ...(scenario.overrides || {})
  };
}

function entryPriceFor(position, scenario, cfg) {
  if (scenario.useRawEntryPrice && num(position.rawEntryPriceUsd, 0) > 0) {
    return num(position.rawEntryPriceUsd, 0) * (1 + num(cfg.entrySlippagePct, 0));
  }
  return num(position.entryPriceUsd, 0);
}

function sampleReturn(sample, entryPriceUsd, cfg) {
  const priceUsd = num(sample.priceUsd, 0);
  if (!(entryPriceUsd > 0) || !(priceUsd > 0)) return null;
  const effectiveExitPriceUsd = priceUsd * (1 - num(cfg.exitSlippagePct, 0));
  return (effectiveExitPriceUsd - entryPriceUsd) / entryPriceUsd;
}

function closeResult(position, scenario, sample, reason, returnPct, maxReturnPct) {
  const nominalUsd = num(position.nominalUsd, 100);
  const solUsd = num(sample.solUsd, num(position.currentSolUsd, num(position.entrySolUsd, 0)));
  const pnlUsd = nominalUsd * returnPct;
  return {
    scenario: scenario.name,
    mint: position.mint || null,
    symbol: position.symbol || null,
    statusAtReplayStart: position.status || null,
    actualExitReason: position.exitReason || null,
    actualReturnPct: compact(position.returnPct),
    actualPnlUsd: compact(position.pnlUsd),
    actualPnlSol: compact(position.pnlSol),
    openedAt: position.openedAt || null,
    replayExitAt: sample.timestamp,
    replayExitReason: reason,
    replayReturnPct: compact(returnPct),
    replayPnlUsd: compact(pnlUsd),
    replayPnlSol: solUsd > 0 ? compact(pnlUsd / solUsd, 9) : null,
    holdHours: compact(hoursBetween(position.openedAt, sample.timestamp), 4),
    observedSamples: eventSamples(position).length,
    maxObservedReturnPct: compact(maxReturnPct),
    entryScore: compact(position.entryScore, 2),
    paperProfile: position.paperProfile || null,
    sourceLabel: position.sourceLabel || null,
    entryRiskFlags: Array.isArray(position.entryRiskFlags) ? position.entryRiskFlags : []
  };
}

function replayPosition(position, scenario) {
  const samples = eventSamples(position);
  const cfg = configFor(position, scenario);
  const entryPriceUsd = entryPriceFor(position, scenario, cfg);
  let maxReturnPct = -Infinity;
  let breakevenActivated = false;

  for (const sample of samples) {
    const returnPct = sampleReturn(sample, entryPriceUsd, cfg);
    if (returnPct === null) continue;
    maxReturnPct = Math.max(maxReturnPct, returnPct);
    if (num(cfg.breakevenActivationPct, 0) > 0 && maxReturnPct >= num(cfg.breakevenActivationPct, 0)) {
      breakevenActivated = true;
    }

    const holdHours = hoursBetween(position.openedAt, sample.timestamp);
    const holdMinutes = minutesBetween(position.openedAt, sample.timestamp);
    const trailingStopReturn = maxReturnPct - num(cfg.trailingStopPct, 0);
    let reason = null;

    if (returnPct >= num(cfg.takeProfitPct, 0)) {
      reason = 'TAKE_PROFIT';
    } else if (returnPct <= -num(cfg.stopLossPct, 0)) {
      reason = 'STOP_LOSS';
    } else if (breakevenActivated && returnPct <= num(cfg.breakevenStopPct, 0)) {
      reason = 'BREAKEVEN_STOP';
    } else if (maxReturnPct > 0 && returnPct <= trailingStopReturn) {
      reason = 'TRAILING_STOP';
    } else if (
      Number.isFinite(holdMinutes)
      && num(scenario.fastFadeMinutes, 0) > 0
      && holdMinutes >= num(scenario.fastFadeMinutes, 0)
    ) {
      reason = scenario.fastFadeReason || `FAST_FADE_${num(scenario.fastFadeMinutes, 0)}M`;
    } else if (Number.isFinite(holdHours) && holdHours >= num(cfg.maxHoldHours, 0)) {
      reason = 'MAX_HOLD';
    }

    if (reason) {
      return closeResult(position, scenario, sample, reason, returnPct, maxReturnPct);
    }
  }

  const last = samples[samples.length - 1] || {};
  const lastReturn = samples.length ? sampleReturn(last, entryPriceUsd, cfg) : num(position.returnPct, 0);
  return closeResult(position, scenario, last, position.status === 'OPEN' ? 'STILL_OPEN_AT_LAST_SAMPLE' : 'END_OF_SAMPLES', lastReturn || 0, maxReturnPct);
}

function firstSampleAfter(position, samples, afterMinutes) {
  return samples.find((sample) => {
    const holdMinutes = minutesBetween(position.openedAt, sample.timestamp);
    return Number.isFinite(holdMinutes) && holdMinutes >= afterMinutes;
  }) || null;
}

function replayStagedPosition(position, scenario) {
  const samples = eventSamples(position);
  const cfg = configFor(position, scenario);
  const entryPriceUsd = entryPriceFor(position, scenario, cfg);
  const nominalUsd = num(position.nominalUsd, 100);
  const legs = [];
  let usedFraction = 0;
  let maxReturnPct = -Infinity;

  for (const sample of samples) {
    const returnPct = sampleReturn(sample, entryPriceUsd, cfg);
    if (returnPct !== null) maxReturnPct = Math.max(maxReturnPct, returnPct);
  }

  for (const stage of (scenario.stages || [])) {
    const fraction = Math.max(0, Math.min(1, num(stage.fraction, 0)));
    if (fraction <= 0 || usedFraction >= 1) continue;
    const effectiveFraction = Math.min(fraction, 1 - usedFraction);
    const sample = firstSampleAfter(position, samples, num(stage.afterMinutes, 0)) || samples[samples.length - 1] || {};
    const returnPct = sampleReturn(sample, entryPriceUsd, cfg) ?? num(position.returnPct, 0);
    const solUsd = num(sample.solUsd, num(position.currentSolUsd, num(position.entrySolUsd, 0)));
    const pnlUsd = nominalUsd * effectiveFraction * returnPct;
    legs.push({
      fraction: compact(effectiveFraction, 4),
      reason: stage.reason || `STAGED_EXIT_${num(stage.afterMinutes, 0)}M`,
      exitAt: sample.timestamp || null,
      returnPct: compact(returnPct),
      pnlUsd: compact(pnlUsd),
      pnlSol: solUsd > 0 ? compact(pnlUsd / solUsd, 9) : null,
      holdHours: compact(hoursBetween(position.openedAt, sample.timestamp), 4)
    });
    usedFraction += effectiveFraction;
  }

  const runnerFraction = Math.max(0, Math.min(1 - usedFraction, num(scenario.runnerFraction, 1 - usedFraction)));
  let runnerResult = null;
  if (runnerFraction > 0) {
    runnerResult = replayPosition(position, {
      ...scenario,
      stagedExit: false,
      name: `${scenario.name}_runner`,
      description: `${scenario.description} runner leg`
    });
    legs.push({
      fraction: compact(runnerFraction, 4),
      reason: `RUNNER_${runnerResult.replayExitReason || 'UNKNOWN'}`,
      exitAt: runnerResult.replayExitAt || null,
      returnPct: runnerResult.replayReturnPct,
      pnlUsd: compact(num(runnerResult.replayPnlUsd, 0) * runnerFraction),
      pnlSol: compact(num(runnerResult.replayPnlSol, 0) * runnerFraction, 9),
      holdHours: runnerResult.holdHours
    });
  }

  const totalPnlUsd = legs.reduce((sum, leg) => sum + num(leg.pnlUsd, 0), 0);
  const totalPnlSol = legs.reduce((sum, leg) => sum + num(leg.pnlSol, 0), 0);
  const lastLeg = legs[legs.length - 1] || {};
  return {
    scenario: scenario.name,
    mint: position.mint || null,
    symbol: position.symbol || null,
    statusAtReplayStart: position.status || null,
    actualExitReason: position.exitReason || null,
    actualReturnPct: compact(position.returnPct),
    actualPnlUsd: compact(position.pnlUsd),
    actualPnlSol: compact(position.pnlSol),
    openedAt: position.openedAt || null,
    replayExitAt: lastLeg.exitAt || null,
    replayExitReason: 'STAGED_EXIT',
    replayReturnPct: nominalUsd > 0 ? compact(totalPnlUsd / nominalUsd) : null,
    replayPnlUsd: compact(totalPnlUsd),
    replayPnlSol: compact(totalPnlSol, 9),
    holdHours: lastLeg.holdHours ?? null,
    observedSamples: samples.length,
    maxObservedReturnPct: compact(maxReturnPct),
    entryScore: compact(position.entryScore, 2),
    paperProfile: position.paperProfile || null,
    sourceLabel: position.sourceLabel || null,
    entryRiskFlags: Array.isArray(position.entryRiskFlags) ? position.entryRiskFlags : [],
    stagedLegs: legs
  };
}

function replayScenarioPosition(position, scenario) {
  if (scenario.stagedExit) return replayStagedPosition(position, scenario);
  return replayPosition(position, scenario);
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] || 'UNKNOWN';
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function summarizeScenario(rows) {
  const closedRows = rows.filter((row) => !['STILL_OPEN_AT_LAST_SAMPLE', 'END_OF_SAMPLES'].includes(row.replayExitReason));
  const wins = closedRows.filter((row) => num(row.replayPnlUsd, 0) > 0).length;
  const losses = closedRows.filter((row) => num(row.replayPnlUsd, 0) < 0).length;
  const totalPnlUsd = rows.reduce((sum, row) => sum + num(row.replayPnlUsd, 0), 0);
  const totalPnlSol = rows.reduce((sum, row) => sum + num(row.replayPnlSol, 0), 0);
  return {
    positions: rows.length,
    closedOrWouldClose: closedRows.length,
    wins,
    losses,
    winRate: closedRows.length ? compact(wins / closedRows.length, 4) : null,
    totalPnlUsd: compact(totalPnlUsd, 6),
    totalPnlSol: compact(totalPnlSol, 9),
    averagePnlUsd: rows.length ? compact(totalPnlUsd / rows.length, 6) : null,
    exitReasons: countBy(rows, 'replayExitReason')
  };
}

function slippageTax(position) {
  const open = eventSamples(position)[0];
  if (!open) return null;
  return {
    mint: position.mint || null,
    symbol: position.symbol || null,
    rawEntryPriceUsd: compact(position.rawEntryPriceUsd, 12),
    entryPriceUsd: compact(position.entryPriceUsd, 12),
    configuredEntrySlippagePct: compact(num(position.config?.entrySlippagePct, 0)),
    configuredExitSlippagePct: compact(num(position.config?.exitSlippagePct, 0)),
    openReturnPct: compact(open.returnPct),
    openPnlUsd: compact(open.pnlUsd),
    note: 'Open return reflects configured entry/exit slippage before price movement.'
  };
}

function buildReport() {
  const state = readJson(STATE_PATH, { positions: [] });
  const continuationReport = readJson(CONTINUATION_REPORT_PATH, {});
  const positions = Array.isArray(state.positions) ? state.positions : [];
  const scenarioRows = {};
  const scenarioSummaries = {};

  for (const scenario of SCENARIOS) {
    const rows = positions.map((position) => replayScenarioPosition(position, scenario));
    scenarioRows[scenario.name] = rows;
    scenarioSummaries[scenario.name] = {
      description: scenario.description,
      overrides: scenario.overrides || {},
      ...summarizeScenario(rows)
    };
  }

  const baselineSummary = scenarioSummaries.current_config_replay || {};
  const baselinePnlUsd = num(baselineSummary.totalPnlUsd, null);
  const baselinePnlSol = num(baselineSummary.totalPnlSol, null);
  for (const summary of Object.values(scenarioSummaries)) {
    const pnlUsd = num(summary.totalPnlUsd, null);
    const pnlSol = num(summary.totalPnlSol, null);
    summary.deltaVsCurrentConfigUsd = Number.isFinite(pnlUsd) && Number.isFinite(baselinePnlUsd)
      ? compact(pnlUsd - baselinePnlUsd, 6)
      : null;
    summary.deltaVsCurrentConfigSol = Number.isFinite(pnlSol) && Number.isFinite(baselinePnlSol)
      ? compact(pnlSol - baselinePnlSol, 9)
      : null;
  }

  const actualRows = positions.map((position) => ({
    mint: position.mint || null,
    symbol: position.symbol || null,
    status: position.status || null,
    exitReason: position.exitReason || (position.status === 'OPEN' ? 'OPEN' : 'UNKNOWN'),
    returnPct: compact(position.returnPct),
    pnlUsd: compact(position.pnlUsd),
    pnlSol: compact(position.pnlSol),
    holdHours: compact(position.holdHours ?? hoursBetween(position.openedAt, position.closedAt || state.updatedAt), 4),
    observedSamples: eventSamples(position).length,
    openedAt: position.openedAt || null,
    closedAt: position.closedAt || null,
    paperProfile: position.paperProfile || null
  }));

  const closedActual = actualRows.filter((row) => row.status === 'CLOSED');
  const openActual = actualRows.filter((row) => row.status === 'OPEN');
  const actualPnlUsd = actualRows.reduce((sum, row) => sum + num(row.pnlUsd, 0), 0);
  const actualPnlSol = actualRows.reduce((sum, row) => sum + num(row.pnlSol, 0), 0);

  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only',
    sources: {
      statePath: rel(STATE_PATH),
      continuationPaperPath: rel(CONTINUATION_REPORT_PATH)
    },
    inputs: {
      stateUpdatedAt: state.updatedAt || null,
      continuationReportGeneratedAt: continuationReport.generatedAt || null,
      positions: positions.length,
      timelineLimitation: 'Replay uses only observed OPEN/UPDATE samples from the continuation paper state. It cannot infer prices between samples.'
    },
    summary: {
      actualPositions: actualRows.length,
      actualClosed: closedActual.length,
      actualOpen: openActual.length,
      actualPnlUsd: compact(actualPnlUsd, 6),
      actualPnlSol: compact(actualPnlSol, 9),
      actualExitReasons: countBy(actualRows, 'exitReason'),
      scenarioSummaries,
      bestScenarioByTotalPnlUsd: Object.entries(scenarioSummaries)
        .sort((a, b) => num(b[1].totalPnlUsd, -Infinity) - num(a[1].totalPnlUsd, -Infinity))[0]?.[0] || null,
      staleExitRiskCount: actualRows.filter((row) => row.holdHours !== null && row.holdHours > 24).length,
      slippageTaxLikelyDominant: positions.some((position) => num(eventSamples(position)[0]?.returnPct, 0) <= -0.1)
    },
    actualRows,
    scenarioRows,
    slippageTax: positions.map(slippageTax).filter(Boolean),
    notes: [
      'Report-only continuation exit replay. Does not change continuation entries, exits, thresholds, live behavior, or wallet behavior.',
      'Sparse update cadence means max-hold exits are evaluated at the first observed sample after the hold threshold, not exact wall-clock crossing.',
      'The no_slippage_reference scenario is not a recommendation; it isolates how much of continuation paper PnL is caused by configured paper slippage.'
    ]
  };
}

function main() {
  const report = buildReport();
  writeJson(OUTPUT_PATH, report);
  console.log(JSON.stringify(report.summary, null, 2));
  console.log(`Wrote ${rel(OUTPUT_PATH)}`);
}

main();
