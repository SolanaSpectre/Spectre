const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_SPECIMEN_PATH = path.join(REPO_ROOT, 'data', 'reports', 'continuation-specimens-latest.json');
const DEFAULT_INTERNAL_SPECIMEN_PATH = path.join(REPO_ROOT, 'data', 'reports', 'internal-continuation-specimens-latest.json');
const DEFAULT_STATE_PATH = path.join(REPO_ROOT, 'data', 'continuation-paper', 'state.json');
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'continuation-paper-latest.json');
const DEFAULT_REPORT_DIR = path.join(REPO_ROOT, 'data', 'reports', 'continuation-paper');
const DEFAULT_LEARNING_PATH = path.join(REPO_ROOT, 'data', 'reports', 'learning-orchestrator-latest.json');

const DEFAULT_CONFIG = {
  nominalUsd: 100,
  entrySlippagePct: 0.05,
  exitSlippagePct: 0.075,
  takeProfitPct: 0.35,
  stopLossPct: 0.22,
  trailingStopPct: 0.18,
  maxHoldHours: 6,
  legacyTakeProfitPct: 0.6,
  legacyStopLossPct: 0.28,
  legacyTrailingStopPct: 0.24,
  legacyMaxHoldHours: 24,
  allowReopen: false,
  respectLearningPosture: true
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
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

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function readJson(filePath, fallback) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function hoursBetween(startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 3600000;
}

function loadState(statePath) {
  const state = readJson(statePath, null);
  if (state && Array.isArray(state.positions)) return state;
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    positions: []
  };
}

function configFromArgs(args) {
  const config = { ...DEFAULT_CONFIG };
  const mapping = {
    nominalUsd: 'nominalUsd',
    takeProfit: 'takeProfitPct',
    stopLoss: 'stopLossPct',
    trailingStop: 'trailingStopPct',
    maxHoldHours: 'maxHoldHours',
    allowReopen: 'allowReopen',
    respectLearningPosture: 'respectLearningPosture'
  };

  for (const [argKey, configKey] of Object.entries(mapping)) {
    if (args[argKey] === undefined) continue;
    if (configKey === 'allowReopen' || configKey === 'respectLearningPosture') {
      config[configKey] = toBool(args[argKey], true);
      continue;
    }
    const numeric = Number(args[argKey]);
    if (Number.isFinite(numeric)) config[configKey] = numeric;
  }

  if (toBool(args.ignoreLearningPosture, false)) {
    config.respectLearningPosture = false;
  }

  return config;
}

function isEligibleSpecimen(specimen) {
  const riskFlags = Array.isArray(specimen?.riskFlags) ? specimen.riskFlags : [];
  return Boolean(
    specimen?.shadowPaper?.enabled
    && specimen.mint
    && Number(specimen.priceUsd) > 0
    && specimen.label === 'continuation_confirmed'
    && !riskFlags.includes('high_churn')
  );
}

function positionConfig(specimen, config) {
  const legacy = specimen.label === 'legacy_revived_watch' || (specimen.reasons || []).includes('legacy_revived');
  return {
    takeProfitPct: Number(specimen.shadowPaper?.plannedTakeProfitPct ?? (legacy ? config.legacyTakeProfitPct : config.takeProfitPct)),
    stopLossPct: Number(specimen.shadowPaper?.plannedStopLossPct ?? (legacy ? config.legacyStopLossPct : config.stopLossPct)),
    trailingStopPct: Number(specimen.shadowPaper?.plannedTrailingStopPct ?? (legacy ? config.legacyTrailingStopPct : config.trailingStopPct)),
    maxHoldHours: Number(specimen.shadowPaper?.maxHoldHours ?? (legacy ? config.legacyMaxHoldHours : config.maxHoldHours)),
    entrySlippagePct: Number(specimen.shadowPaper?.entrySlippagePct ?? config.entrySlippagePct),
    exitSlippagePct: Number(specimen.shadowPaper?.exitSlippagePct ?? config.exitSlippagePct)
  };
}

function openPosition(specimen, config, nowIso) {
  const cfg = positionConfig(specimen, config);
  const rawEntryPriceUsd = Number(specimen.priceUsd);
  const entryPriceUsd = rawEntryPriceUsd * (1 + cfg.entrySlippagePct);
  const effectiveExitPriceUsd = rawEntryPriceUsd * (1 - cfg.exitSlippagePct);
  const openingReturnPct = entryPriceUsd > 0 ? (effectiveExitPriceUsd - entryPriceUsd) / entryPriceUsd : 0;
  const openingPnlUsd = Number(config.nominalUsd || 0) * openingReturnPct;
  return {
    id: `${specimen.mint}:${nowIso}`,
    mint: specimen.mint,
    symbol: specimen.symbol || null,
    name: specimen.name || null,
    status: 'OPEN',
    openedAt: nowIso,
    closedAt: null,
    sourceLabel: specimen.label,
    entryScore: compact(specimen.continuationScore, 2),
    entryReasons: specimen.reasons || [],
    entryRiskFlags: specimen.riskFlags || [],
    dexscreenerUrl: specimen.dexscreenerUrl || null,
    primaryDexId: specimen.primaryDexId || null,
    nominalUsd: config.nominalUsd,
    rawEntryPriceUsd: compact(rawEntryPriceUsd, 12),
    entryPriceUsd: compact(entryPriceUsd, 12),
    currentPriceUsd: compact(rawEntryPriceUsd, 12),
    effectiveExitPriceUsd: compact(effectiveExitPriceUsd, 12),
    maxPriceUsd: compact(rawEntryPriceUsd, 12),
    minPriceUsd: compact(rawEntryPriceUsd, 12),
    maxUnrealizedReturnPct: compact(openingReturnPct, 6),
    maxDrawdownPct: 0,
    returnPct: compact(openingReturnPct, 6),
    pnlUsd: compact(openingPnlUsd, 6),
    exitReason: null,
    updates: 0,
    lastUpdatedAt: nowIso,
    config: cfg,
    entrySnapshot: {
      liquidityUsd: specimen.liquidityUsd ?? null,
      volume1hUsd: specimen.volume1hUsd ?? null,
      volumeToLiquidity1h: specimen.volumeToLiquidity1h ?? null,
      priceChange1hPct: specimen.priceChange1hPct ?? null,
      ageHours: specimen.ageHours ?? null,
      rickOverlap: specimen.rickOverlap || null
    },
    timeline: [{
      timestamp: nowIso,
      event: 'OPEN',
      priceUsd: compact(rawEntryPriceUsd, 12),
      effectiveExitPriceUsd: compact(effectiveExitPriceUsd, 12),
      returnPct: compact(openingReturnPct, 6),
      pnlUsd: compact(openingPnlUsd, 6),
      label: specimen.label
    }]
  };
}

function updatePosition(position, market, nowIso) {
  if (position.status !== 'OPEN') return;
  const priceUsd = Number(market?.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    position.timeline.push({
      timestamp: nowIso,
      event: 'NO_PRICE',
      reason: 'No current price available'
    });
    position.lastUpdatedAt = nowIso;
    return;
  }

  const cfg = position.config || DEFAULT_CONFIG;
  const effectiveExitPriceUsd = priceUsd * (1 - Number(cfg.exitSlippagePct || 0));
  const entryPriceUsd = Number(position.entryPriceUsd || 0);
  const returnPct = entryPriceUsd > 0 ? (effectiveExitPriceUsd - entryPriceUsd) / entryPriceUsd : 0;
  const previousMax = Number(position.maxPriceUsd || 0);
  const previousMin = Number(position.minPriceUsd || Infinity);
  const maxPriceUsd = Math.max(previousMax, priceUsd);
  const minPriceUsd = Math.min(previousMin, priceUsd);
  const trailingStopPriceUsd = maxPriceUsd * (1 - Number(cfg.trailingStopPct || 0));
  const holdHours = hoursBetween(position.openedAt, nowIso);

  position.currentPriceUsd = compact(priceUsd, 12);
  position.effectiveExitPriceUsd = compact(effectiveExitPriceUsd, 12);
  position.maxPriceUsd = compact(maxPriceUsd, 12);
  position.minPriceUsd = compact(minPriceUsd, 12);
  position.returnPct = compact(returnPct, 6);
  position.pnlUsd = compact(Number(position.nominalUsd || 0) * returnPct, 6);
  position.maxUnrealizedReturnPct = compact(Math.max(Number(position.maxUnrealizedReturnPct || -Infinity), returnPct), 6);
  position.maxDrawdownPct = compact(entryPriceUsd > 0 ? (minPriceUsd - entryPriceUsd) / entryPriceUsd : 0, 6);
  position.lastUpdatedAt = nowIso;
  position.updates = Number(position.updates || 0) + 1;

  const sample = {
    timestamp: nowIso,
    event: 'UPDATE',
    priceUsd: compact(priceUsd, 12),
    effectiveExitPriceUsd: compact(effectiveExitPriceUsd, 12),
    returnPct: compact(returnPct, 6),
    pnlUsd: compact(Number(position.nominalUsd || 0) * returnPct, 6),
    liquidityUsd: market.liquidityUsd ?? null,
    volume1hUsd: market.volume1hUsd ?? null,
    priceChange1hPct: market.priceChange1hPct ?? null
  };
  position.timeline.push(sample);
  position.timeline = position.timeline.slice(-100);

  let exitReason = null;
  if (returnPct >= Number(cfg.takeProfitPct || 0)) {
    exitReason = 'TAKE_PROFIT';
  } else if (returnPct <= -Number(cfg.stopLossPct || 0)) {
    exitReason = 'STOP_LOSS';
  } else if (priceUsd <= trailingStopPriceUsd && Number(position.maxUnrealizedReturnPct || 0) > 0) {
    exitReason = 'TRAILING_STOP';
  } else if (Number.isFinite(holdHours) && holdHours >= Number(cfg.maxHoldHours || 0)) {
    exitReason = 'MAX_HOLD';
  }

  if (exitReason) {
    closePosition(position, nowIso, exitReason);
  }
}

function closePosition(position, nowIso, reason) {
  position.status = 'CLOSED';
  position.closedAt = nowIso;
  position.exitReason = reason;
  position.holdHours = compact(hoursBetween(position.openedAt, nowIso), 4);
  position.timeline.push({
    timestamp: nowIso,
    event: 'CLOSE',
    reason,
    priceUsd: position.currentPriceUsd,
    returnPct: position.returnPct,
    pnlUsd: position.pnlUsd
  });
}

async function fetchMarketForMint(mint) {
  const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
    timeout: 12000,
    headers: { 'User-Agent': 'SpectreContinuationPaper/1.0' }
  });
  const pairs = Array.isArray(response.data?.pairs)
    ? response.data.pairs.filter((pair) => pair?.chainId === 'solana')
    : [];
  const primary = [...pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
  if (!primary) return null;
  return {
    mint,
    symbol: primary?.baseToken?.symbol || null,
    priceUsd: Number(primary.priceUsd),
    liquidityUsd: compact(primary?.liquidity?.usd, 2),
    volume1hUsd: compact(primary?.volume?.h1, 2),
    priceChange1hPct: compact(primary?.priceChange?.h1, 2),
    dexscreenerUrl: primary.url || null
  };
}

async function resolveMarkets(specimens, openPositions) {
  const markets = new Map();
  for (const specimen of specimens || []) {
    if (!specimen?.mint) continue;
    markets.set(specimen.mint, {
      mint: specimen.mint,
      symbol: specimen.symbol || null,
      priceUsd: Number(specimen.priceUsd),
      liquidityUsd: specimen.liquidityUsd ?? null,
      volume1hUsd: specimen.volume1hUsd ?? null,
      priceChange1hPct: specimen.priceChange1hPct ?? null,
      dexscreenerUrl: specimen.dexscreenerUrl || null
    });
  }

  for (const position of openPositions) {
    if (markets.has(position.mint)) continue;
    try {
      const market = await fetchMarketForMint(position.mint);
      if (market) markets.set(position.mint, market);
    } catch (error) {
      markets.set(position.mint, {
        mint: position.mint,
        error: error.message
      });
    }
  }

  return markets;
}

function summarize(
  state,
  opened,
  updated,
  closed,
  skippedReopen,
  skippedIneligible,
  skippedLearning,
  specimenReport,
  internalSpecimenReport,
  combinedSpecimens,
  learningPause
) {
  const positions = state.positions || [];
  const open = positions.filter((position) => position.status === 'OPEN');
  const closedPositions = positions.filter((position) => position.status === 'CLOSED');
  const closedPnl = closedPositions.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  const openPnl = open.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  return {
    generatedAt: new Date().toISOString(),
    source: {
      specimenGeneratedAt: specimenReport.generatedAt || null,
      specimenSummary: specimenReport.summary || null,
      internalSpecimenGeneratedAt: internalSpecimenReport.generatedAt || null,
      internalSpecimenSummary: internalSpecimenReport.summary || null,
      combinedSpecimens: combinedSpecimens.length
    },
    summary: {
      openedThisRun: opened.length,
      updatedThisRun: updated.length,
      closedThisRun: closed.length,
      skippedReopenThisRun: skippedReopen.length,
      skippedIneligibleThisRun: skippedIneligible.length,
      skippedLearningThisRun: skippedLearning.length,
      learningPauseActive: learningPause.active,
      learningRegime: learningPause.marketRegime,
      learningContinuationPosture: learningPause.continuationPosture,
      openPositions: open.length,
      closedPositions: closedPositions.length,
      totalPositions: positions.length,
      openPnlUsd: compact(openPnl, 6),
      closedPnlUsd: compact(closedPnl, 6),
      totalMarkedPnlUsd: compact(openPnl + closedPnl, 6),
      exitsByReason: closedPositions.reduce((counts, position) => {
        const reason = position.exitReason || 'UNKNOWN';
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {})
    },
    opened,
    updated,
    closed,
    skippedReopen,
    skippedIneligible,
    skippedLearning,
    learningPause,
    openPositions: open,
    recentClosedPositions: closedPositions.slice(-20)
  };
}

function paperIneligibleReason(specimen) {
  const riskFlags = Array.isArray(specimen?.riskFlags) ? specimen.riskFlags : [];
  if (!specimen?.shadowPaper?.enabled) return null;
  if (!specimen.mint) return 'MISSING_MINT';
  if (!(Number(specimen.priceUsd) > 0)) return 'MISSING_PRICE';
  if (specimen.label !== 'continuation_confirmed') return `LABEL_${String(specimen.label || 'UNKNOWN').toUpperCase()}`;
  if (riskFlags.includes('high_churn')) return 'HIGH_CHURN';
  return null;
}

function mergeSpecimenReports(primaryReport, internalReport) {
  const byMint = new Map();
  const all = [
    ...(Array.isArray(primaryReport?.specimens) ? primaryReport.specimens : []),
    ...(Array.isArray(internalReport?.specimens) ? internalReport.specimens : [])
  ];

  for (const specimen of all) {
    if (!specimen?.mint) continue;
    const current = byMint.get(specimen.mint);
    const currentScore = Number(current?.continuationScore || 0);
    const score = Number(specimen.continuationScore || 0);
    const currentConfirmed = current?.label === 'continuation_confirmed';
    const confirmed = specimen.label === 'continuation_confirmed';
    if (!current || (confirmed && !currentConfirmed) || (confirmed === currentConfirmed && score >= currentScore)) {
      byMint.set(specimen.mint, specimen);
    }
  }

  return Array.from(byMint.values()).sort((a, b) => Number(b.continuationScore || 0) - Number(a.continuationScore || 0));
}

function resolveLearningPause(args, config) {
  const learningPath = resolveRepoPath(args.learning, DEFAULT_LEARNING_PATH);
  const learning = readJson(learningPath, null);
  const laneRecommendations = Array.isArray(learning?.recommendations?.laneRecommendations)
    ? learning.recommendations.laneRecommendations
    : [];
  const continuation = laneRecommendations.find((item) => item.lane === 'continuation') || null;
  const marketRegime = learning?.regime?.marketRegime || null;
  const recommendedPosture = learning?.recommendations?.recommendedPosture || null;
  const continuationPosture = continuation?.posture || null;
  const active = Boolean(
    config.respectLearningPosture
    && learning
    && (
      continuationPosture === 'pause_paper_entries'
      || (marketRegime === 'chop_fade' && recommendedPosture === 'observe_only')
    )
  );

  return {
    active,
    reason: active ? 'LEARNING_ORCHESTRATOR_PAUSED_CONTINUATION' : null,
    learningPath,
    learningGeneratedAt: learning?.generatedAt || null,
    marketRegime,
    recommendedPosture,
    continuationPosture,
    rationale: continuation?.rationale || null,
    respectLearningPosture: config.respectLearningPosture
  };
}

async function buildLedger(args) {
  const specimenPath = resolveRepoPath(args.specimens, DEFAULT_SPECIMEN_PATH);
  const internalSpecimenPath = resolveRepoPath(args.internalSpecimens, DEFAULT_INTERNAL_SPECIMEN_PATH);
  const statePath = resolveRepoPath(args.state, DEFAULT_STATE_PATH);
  const reportPath = resolveRepoPath(args.out, DEFAULT_REPORT_PATH);
  const reportDir = resolveRepoPath(args.reportDir, DEFAULT_REPORT_DIR);
  const config = configFromArgs(args);
  const learningPause = resolveLearningPause(args, config);
  const nowIso = new Date().toISOString();
  const specimenReport = readJson(specimenPath, { specimens: [] });
  const internalSpecimenReport = readJson(internalSpecimenPath, { specimens: [] });
  const combinedSpecimens = mergeSpecimenReports(specimenReport, internalSpecimenReport);
  const state = loadState(statePath);
  const positions = state.positions;
  const openBefore = positions.filter((position) => position.status === 'OPEN');
  const markets = await resolveMarkets(combinedSpecimens, openBefore);
  const opened = [];
  const updated = [];
  const closed = [];
  const skippedReopen = [];
  const skippedIneligible = [];
  const skippedLearning = [];

  for (const position of openBefore) {
    const market = markets.get(position.mint);
    updatePosition(position, market, nowIso);
    updated.push({
      mint: position.mint,
      symbol: position.symbol,
      status: position.status,
      returnPct: position.returnPct,
      pnlUsd: position.pnlUsd,
      exitReason: position.exitReason || null
    });
    if (position.status === 'CLOSED') {
      closed.push(position);
    }
  }

  const openMints = new Set(positions.filter((position) => position.status === 'OPEN').map((position) => position.mint));
  const everOpened = new Set(positions.map((position) => position.mint));
  for (const specimen of combinedSpecimens) {
    if (!isEligibleSpecimen(specimen)) {
      const reason = paperIneligibleReason(specimen);
      if (reason) {
        skippedIneligible.push({
          mint: specimen.mint || null,
          symbol: specimen.symbol || null,
          label: specimen.label || null,
          score: compact(specimen.continuationScore, 2),
          reason,
          riskFlags: Array.isArray(specimen.riskFlags) ? specimen.riskFlags : []
        });
      }
      continue;
    }
    if (openMints.has(specimen.mint)) continue;
    if (learningPause.active) {
      skippedLearning.push({
        mint: specimen.mint,
        symbol: specimen.symbol || null,
        label: specimen.label || null,
        score: compact(specimen.continuationScore, 2),
        reason: learningPause.reason,
        marketRegime: learningPause.marketRegime,
        continuationPosture: learningPause.continuationPosture,
        learningGeneratedAt: learningPause.learningGeneratedAt
      });
      continue;
    }
    if (!config.allowReopen && everOpened.has(specimen.mint)) {
      skippedReopen.push({
        mint: specimen.mint,
        symbol: specimen.symbol || null,
        label: specimen.label || null,
        score: compact(specimen.continuationScore, 2),
        reason: 'MINT_ALREADY_TRADED',
        previousPositions: positions
          .filter((position) => position.mint === specimen.mint)
          .map((position) => ({
            id: position.id,
            status: position.status,
            openedAt: position.openedAt,
            closedAt: position.closedAt || null,
            exitReason: position.exitReason || null,
            returnPct: position.returnPct ?? null,
            pnlUsd: position.pnlUsd ?? null
          }))
      });
      continue;
    }
    const position = openPosition(specimen, config, nowIso);
    positions.push(position);
    openMints.add(specimen.mint);
    everOpened.add(specimen.mint);
    opened.push(position);
  }

  state.updatedAt = nowIso;
  state.config = config;
  writeJson(statePath, state);

  const report = summarize(
    state,
    opened,
    updated,
    closed,
    skippedReopen,
    skippedIneligible,
    skippedLearning,
    specimenReport,
    internalSpecimenReport,
    combinedSpecimens,
    learningPause
  );
  const timestampedPath = path.join(reportDir, `continuation-paper-${nowIso.replace(/[:.]/g, '-')}.json`);
  report.files = {
    specimenPath,
    internalSpecimenPath,
    statePath,
    reportPath,
    timestampedPath,
    learningPath: learningPause.learningPath
  };
  writeJson(reportPath, report);
  writeJson(timestampedPath, report);
  return report;
}

function printReport(report) {
  console.log('Continuation Paper Ledger');
  console.log('=========================');
  console.log(`Opened this run: ${report.summary.openedThisRun}`);
  console.log(`Updated this run: ${report.summary.updatedThisRun}`);
  console.log(`Closed this run: ${report.summary.closedThisRun}`);
  console.log(`Skipped reopens: ${report.summary.skippedReopenThisRun}`);
  console.log(`Skipped ineligible: ${report.summary.skippedIneligibleThisRun}`);
  console.log(`Skipped learning: ${report.summary.skippedLearningThisRun}`);
  console.log(`Combined specimens: ${report.source.combinedSpecimens}`);
  console.log(`Open positions:   ${report.summary.openPositions}`);
  console.log(`Open PnL:         $${report.summary.openPnlUsd}`);
  console.log(`Closed PnL:       $${report.summary.closedPnlUsd}`);

  if (report.learningPause?.active) {
    console.log(
      `Learning pause:   ${report.learningPause.marketRegime || 'unknown'} / ${report.learningPause.continuationPosture || 'unknown'}`
    );
  }

  if (report.opened.length > 0) {
    console.log('\nOpened');
    for (const position of report.opened) {
      console.log(`  ${position.symbol || position.mint}: ${position.sourceLabel} entry=$${position.entryPriceUsd} score=${position.entryScore}`);
    }
  }

  if (report.updated.length > 0) {
    console.log('\nUpdated');
    for (const item of report.updated) {
      const exit = item.exitReason ? ` exit=${item.exitReason}` : '';
      console.log(`  ${item.symbol || item.mint}: ${item.status} return=${item.returnPct} pnl=$${item.pnlUsd}${exit}`);
    }
  }

  if (report.skippedReopen.length > 0) {
    console.log('\nSkipped Reopens');
    for (const item of report.skippedReopen) {
      console.log(`  ${item.symbol || item.mint}: ${item.reason} score=${item.score}`);
    }
  }

  if (report.skippedIneligible.length > 0) {
    console.log('\nSkipped Ineligible');
    for (const item of report.skippedIneligible.slice(0, 10)) {
      console.log(`  ${item.symbol || item.mint}: ${item.reason} score=${item.score}`);
    }
  }

  if (report.skippedLearning.length > 0) {
    console.log('\nSkipped By Learning Orchestrator');
    for (const item of report.skippedLearning.slice(0, 10)) {
      console.log(`  ${item.symbol || item.mint}: ${item.reason} score=${item.score}`);
    }
  }

  console.log(`\nWrote JSON report: ${report.files.reportPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await buildLedger(args);
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`continuation-paper-ledger failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildLedger,
  openPosition,
  updatePosition
};
