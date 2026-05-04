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
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const DEFAULT_CONFIG = {
  nominalUsd: 100,
  entrySlippagePct: Number(process.env.CONTINUATION_PAPER_ENTRY_SLIPPAGE_PCT || 0.01),
  exitSlippagePct: Number(process.env.CONTINUATION_PAPER_EXIT_SLIPPAGE_PCT || 0.015),
  takeProfitPct: 0.24,
  stopLossPct: 0.16,
  trailingStopPct: 0.1,
  maxHoldHours: 4,
  breakevenActivationPct: 0.12,
  breakevenStopPct: 0.015,
  legacyTakeProfitPct: 0.45,
  legacyStopLossPct: 0.22,
  legacyTrailingStopPct: 0.16,
  legacyMaxHoldHours: 24,
  legacyBreakevenActivationPct: 0.2,
  legacyBreakevenStopPct: 0.025,
  stagedExitEnabled: process.env.CONTINUATION_PAPER_STAGED_EXIT_ENABLED === 'true',
  stagedExitFirstFraction: Number(process.env.CONTINUATION_PAPER_STAGED_EXIT_FIRST_FRACTION || 0.5),
  stagedExitFirstAfterMinutes: Number(process.env.CONTINUATION_PAPER_STAGED_EXIT_FIRST_AFTER_MINUTES || 3),
  stagedExitSecondFraction: Number(process.env.CONTINUATION_PAPER_STAGED_EXIT_SECOND_FRACTION || 0.4),
  stagedExitSecondAfterMinutes: Number(process.env.CONTINUATION_PAPER_STAGED_EXIT_SECOND_AFTER_MINUTES || 10),
  chopFadeScalperEnabled: process.env.CONTINUATION_CHOP_FADE_SCALPER_ENABLED !== 'false',
  chopFadeRequiresLearningRegime: process.env.CONTINUATION_CHOP_FADE_REQUIRES_LEARNING_REGIME !== 'false',
  chopFadeNominalUsd: Number(process.env.CONTINUATION_CHOP_FADE_NOMINAL_USD || 50),
  chopFadeMinLiquidityUsd: Number(process.env.CONTINUATION_CHOP_FADE_MIN_LIQUIDITY_USD || 40000),
  chopFadeMinVolumeToLiquidity1h: Number(process.env.CONTINUATION_CHOP_FADE_MIN_VOLUME_TO_LIQUIDITY_1H || 1.2),
  chopFadeMinPriceChange1hPct: Number(process.env.CONTINUATION_CHOP_FADE_MIN_PRICE_CHANGE_1H_PCT || -35),
  chopFadeMaxPriceChange1hPct: Number(process.env.CONTINUATION_CHOP_FADE_MAX_PRICE_CHANGE_1H_PCT || 120),
  chopFadeTakeProfitPct: Number(process.env.CONTINUATION_CHOP_FADE_TAKE_PROFIT_PCT || 0.1),
  chopFadeStopLossPct: Number(process.env.CONTINUATION_CHOP_FADE_STOP_LOSS_PCT || 0.07),
  chopFadeTrailingStopPct: Number(process.env.CONTINUATION_CHOP_FADE_TRAILING_STOP_PCT || 0.045),
  chopFadeMaxHoldHours: Number(process.env.CONTINUATION_CHOP_FADE_MAX_HOLD_HOURS || 1.5),
  chopFadeBreakevenActivationPct: Number(process.env.CONTINUATION_CHOP_FADE_BREAKEVEN_ACTIVATION_PCT || 0.055),
  chopFadeBreakevenStopPct: Number(process.env.CONTINUATION_CHOP_FADE_BREAKEVEN_STOP_PCT || 0.008),
  chopFadeEntrySlippagePct: Number(process.env.CONTINUATION_CHOP_FADE_ENTRY_SLIPPAGE_PCT || 0.04),
  chopFadeExitSlippagePct: Number(process.env.CONTINUATION_CHOP_FADE_EXIT_SLIPPAGE_PCT || 0.05),
  allowReopen: false,
  respectLearningPosture: true,
  solUsdFallback: Number(process.env.CONTINUATION_PAPER_SOL_USD_FALLBACK || 0)
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

function finiteNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
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
    entrySlippage: 'entrySlippagePct',
    exitSlippage: 'exitSlippagePct',
    takeProfit: 'takeProfitPct',
    stopLoss: 'stopLossPct',
    trailingStop: 'trailingStopPct',
    maxHoldHours: 'maxHoldHours',
    chopFadeScalperEnabled: 'chopFadeScalperEnabled',
    chopFadeRequiresLearningRegime: 'chopFadeRequiresLearningRegime',
    chopFadeNominalUsd: 'chopFadeNominalUsd',
    chopFadeMinLiquidityUsd: 'chopFadeMinLiquidityUsd',
    chopFadeMinVolumeToLiquidity1h: 'chopFadeMinVolumeToLiquidity1h',
    chopFadeMinPriceChange1hPct: 'chopFadeMinPriceChange1hPct',
    chopFadeMaxPriceChange1hPct: 'chopFadeMaxPriceChange1hPct',
    chopFadeTakeProfit: 'chopFadeTakeProfitPct',
    chopFadeStopLoss: 'chopFadeStopLossPct',
    chopFadeTrailingStop: 'chopFadeTrailingStopPct',
    chopFadeMaxHoldHours: 'chopFadeMaxHoldHours',
    stagedExitEnabled: 'stagedExitEnabled',
    stagedExitFirstFraction: 'stagedExitFirstFraction',
    stagedExitFirstAfterMinutes: 'stagedExitFirstAfterMinutes',
    stagedExitSecondFraction: 'stagedExitSecondFraction',
    stagedExitSecondAfterMinutes: 'stagedExitSecondAfterMinutes',
    allowReopen: 'allowReopen',
    respectLearningPosture: 'respectLearningPosture'
  };

  for (const [argKey, configKey] of Object.entries(mapping)) {
    if (args[argKey] === undefined) continue;
    if (configKey === 'allowReopen' || configKey === 'respectLearningPosture' || configKey === 'chopFadeScalperEnabled' || configKey === 'chopFadeRequiresLearningRegime' || configKey === 'stagedExitEnabled') {
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

function volumeToLiquidity1h(specimen) {
  const explicit = Number(specimen?.volumeToLiquidity1h);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  const volume = Number(specimen?.volume1hUsd || 0);
  const liquidity = Number(specimen?.liquidityUsd || 0);
  return liquidity > 0 ? volume / liquidity : 0;
}

function priceChange1h(specimen) {
  const value = Number(specimen?.priceChange1hPct);
  return Number.isFinite(value) ? value : 0;
}

function isChopFadeLearningRegime(learningPause) {
  return learningPause?.marketRegime === 'chop_fade' || learningPause?.recommendedPosture === 'observe_only';
}

function chopFadeScalperEligibility(specimen, config, learningPause) {
  const riskFlags = Array.isArray(specimen?.riskFlags) ? specimen.riskFlags : [];
  const liquidityUsd = Number(specimen?.liquidityUsd || 0);
  const vtl1h = volumeToLiquidity1h(specimen);
  const change1h = priceChange1h(specimen);

  if (!config.chopFadeScalperEnabled) return { eligible: false, reason: 'CHOP_FADE_DISABLED' };
  if (config.chopFadeRequiresLearningRegime && !isChopFadeLearningRegime(learningPause)) {
    return { eligible: false, reason: 'NOT_CHOP_FADE_REGIME' };
  }
  if (!specimen.mint) return { eligible: false, reason: 'MISSING_MINT' };
  if (!(Number(specimen.priceUsd) > 0)) return { eligible: false, reason: 'MISSING_PRICE' };
  if (!String(specimen.label || '').startsWith('continuation_')) {
    return { eligible: false, reason: `LABEL_${String(specimen.label || 'UNKNOWN').toUpperCase()}` };
  }
  if (!riskFlags.includes('high_churn')) {
    return { eligible: false, reason: 'NOT_HIGH_CHURN' };
  }
  if (vtl1h < Number(config.chopFadeMinVolumeToLiquidity1h || 0)) {
    return { eligible: false, reason: 'LOW_CHOP_CHURN' };
  }
  if (liquidityUsd < Number(config.chopFadeMinLiquidityUsd || 0)) {
    return { eligible: false, reason: 'LOW_CHOP_LIQUIDITY' };
  }
  if (change1h < Number(config.chopFadeMinPriceChange1hPct)) {
    return { eligible: false, reason: 'CHOP_FALLING_KNIFE' };
  }
  if (change1h > Number(config.chopFadeMaxPriceChange1hPct)) {
    return { eligible: false, reason: 'CHOP_BREAKOUT_TOO_HOT' };
  }

  return {
    eligible: true,
    reason: null,
    diagnostics: {
      liquidityUsd: compact(liquidityUsd, 2),
      volumeToLiquidity1h: compact(vtl1h, 4),
      priceChange1hPct: compact(change1h, 2),
      riskFlags
    }
  };
}

function positionConfig(specimen, config, profileName = null) {
  const legacy = specimen.label === 'legacy_revived_watch' || (specimen.reasons || []).includes('legacy_revived');
  if (profileName === 'chop_fade_scalper') {
    return {
      profileName: 'chop_fade_scalper',
      takeProfitPct: Number(config.chopFadeTakeProfitPct),
      stopLossPct: Number(config.chopFadeStopLossPct),
      trailingStopPct: Number(config.chopFadeTrailingStopPct),
      maxHoldHours: Number(config.chopFadeMaxHoldHours),
      breakevenActivationPct: Number(config.chopFadeBreakevenActivationPct),
      breakevenStopPct: Number(config.chopFadeBreakevenStopPct),
      entrySlippagePct: Number(config.chopFadeEntrySlippagePct),
      exitSlippagePct: Number(config.chopFadeExitSlippagePct),
      nominalUsd: Number(config.chopFadeNominalUsd)
    };
  }

  const selectedProfileName = legacy ? 'legacy_revival_smart_trade' : 'continuation_smart_runner';
  return {
    profileName: selectedProfileName,
    takeProfitPct: Number(legacy ? config.legacyTakeProfitPct : config.takeProfitPct),
    stopLossPct: Number(legacy ? config.legacyStopLossPct : config.stopLossPct),
    trailingStopPct: Number(legacy ? config.legacyTrailingStopPct : config.trailingStopPct),
    maxHoldHours: Number(legacy ? config.legacyMaxHoldHours : config.maxHoldHours),
    breakevenActivationPct: Number(legacy ? config.legacyBreakevenActivationPct : config.breakevenActivationPct),
    breakevenStopPct: Number(legacy ? config.legacyBreakevenStopPct : config.breakevenStopPct),
    entrySlippagePct: Number(specimen.shadowPaper?.entrySlippagePct ?? config.entrySlippagePct),
    exitSlippagePct: Number(specimen.shadowPaper?.exitSlippagePct ?? config.exitSlippagePct),
    nominalUsd: Number(config.nominalUsd),
    stagedExitEnabled: Boolean(config.stagedExitEnabled),
    stagedExitStages: buildStagedExitStages(config)
  };
}

function buildStagedExitStages(config) {
  const stages = [
    {
      id: 'stage_1',
      fraction: Number(config.stagedExitFirstFraction),
      afterMinutes: Number(config.stagedExitFirstAfterMinutes),
      reason: 'STAGED_EXIT_50_AT_3M'
    },
    {
      id: 'stage_2',
      fraction: Number(config.stagedExitSecondFraction),
      afterMinutes: Number(config.stagedExitSecondAfterMinutes),
      reason: 'STAGED_EXIT_40_AT_10M'
    }
  ];

  return stages
    .filter((stage) => Number.isFinite(stage.fraction) && stage.fraction > 0 && Number.isFinite(stage.afterMinutes) && stage.afterMinutes >= 0)
    .map((stage) => ({
      ...stage,
      fraction: Math.max(0, Math.min(1, stage.fraction))
    }));
}

function applyPositionPnl(position, returnPct, solUsdPrice = null) {
  const nominalUsd = finiteNumber(position.nominalUsd, 0);
  const openFraction = finiteNumber(position.openFraction, 1);
  const realizedPnlUsd = finiteNumber(position.realizedPnlUsd, 0);
  const openPnlUsd = nominalUsd * openFraction * finiteNumber(returnPct, 0);
  position.pnlUsd = compact(realizedPnlUsd + openPnlUsd, 6);

  const resolvedSolUsd = finiteNumber(solUsdPrice)
    ?? finiteNumber(position.currentSolUsd)
    ?? finiteNumber(position.entrySolUsd);
  if (Number.isFinite(resolvedSolUsd) && resolvedSolUsd > 0) {
    const entrySolUsd = finiteNumber(position.entrySolUsd, resolvedSolUsd);
    const nominalSol = entrySolUsd > 0 ? nominalUsd / entrySolUsd : null;
    const realizedPnlSol = finiteNumber(position.realizedPnlSol, 0);
    position.entrySolUsd = compact(entrySolUsd, 6);
    position.currentSolUsd = compact(resolvedSolUsd, 6);
    position.nominalSol = compact(nominalSol, 9);
    position.pnlSol = compact(realizedPnlSol + (Number(nominalSol || 0) * openFraction * finiteNumber(returnPct, 0)), 9);
  }

  return position;
}

function openPosition(specimen, config, nowIso, profileName = null, entryMeta = {}, solUsdPrice = null) {
  const cfg = positionConfig(specimen, config, profileName);
  const rawEntryPriceUsd = Number(specimen.priceUsd);
  const entryPriceUsd = rawEntryPriceUsd * (1 + cfg.entrySlippagePct);
  const effectiveExitPriceUsd = rawEntryPriceUsd * (1 - cfg.exitSlippagePct);
  const openingReturnPct = entryPriceUsd > 0 ? (effectiveExitPriceUsd - entryPriceUsd) / entryPriceUsd : 0;
  const nominalUsd = Number(cfg.nominalUsd || config.nominalUsd || 0);
  const openingPnlUsd = nominalUsd * openingReturnPct;
  const position = {
    id: `${specimen.mint}:${cfg.profileName}:${nowIso}`,
    mint: specimen.mint,
    symbol: specimen.symbol || null,
    name: specimen.name || null,
    status: 'OPEN',
    openedAt: nowIso,
    closedAt: null,
    sourceLabel: specimen.label,
    paperProfile: cfg.profileName,
    entryMode: profileName === 'chop_fade_scalper' ? 'CHOP_FADE_SCALPER' : 'CONTINUATION_PAPER',
    entryMeta,
    entryScore: compact(specimen.continuationScore, 2),
    entryReasons: specimen.reasons || [],
    entryRiskFlags: specimen.riskFlags || [],
    dexscreenerUrl: specimen.dexscreenerUrl || null,
    primaryDexId: specimen.primaryDexId || null,
    nominalUsd,
    entrySolUsd: compact(solUsdPrice, 6),
    currentSolUsd: compact(solUsdPrice, 6),
    nominalSol: null,
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
    pnlSol: null,
    realizedPnlUsd: 0,
    realizedPnlSol: 0,
    openFraction: 1,
    stagedExits: [],
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
      pnlSol: null,
      solUsd: compact(solUsdPrice, 6),
      label: specimen.label,
      paperProfile: cfg.profileName,
      entryMode: profileName === 'chop_fade_scalper' ? 'CHOP_FADE_SCALPER' : 'CONTINUATION_PAPER'
    }]
  };
  applyPositionPnl(position, openingReturnPct, solUsdPrice);
  position.timeline[0].pnlSol = position.pnlSol;
  return position;
}

function executeDueStagedExits(position, nowIso, returnPct, sample, solUsdPrice = null) {
  const cfg = position.config || {};
  if (!cfg.stagedExitEnabled) return;

  const stages = Array.isArray(cfg.stagedExitStages) ? cfg.stagedExitStages : [];
  if (!stages.length) return;

  const completed = new Set((position.stagedExits || []).map((exit) => exit.id));
  const holdMinutes = hoursBetween(position.openedAt, nowIso) * 60;
  if (!Number.isFinite(holdMinutes)) return;

  for (const stage of stages) {
    if (completed.has(stage.id)) continue;
    if (holdMinutes < Number(stage.afterMinutes || 0)) continue;

    const openFraction = finiteNumber(position.openFraction, 1);
    if (openFraction <= 0) return;
    const fraction = Math.min(openFraction, Math.max(0, Math.min(1, Number(stage.fraction || 0))));
    if (fraction <= 0) continue;

    const nominalUsd = finiteNumber(position.nominalUsd, 0);
    const legPnlUsd = nominalUsd * fraction * finiteNumber(returnPct, 0);
    const nominalSol = finiteNumber(position.nominalSol, null);
    const legPnlSol = Number.isFinite(nominalSol)
      ? nominalSol * fraction * finiteNumber(returnPct, 0)
      : null;

    position.realizedPnlUsd = compact(finiteNumber(position.realizedPnlUsd, 0) + legPnlUsd, 6);
    if (legPnlSol !== null) {
      position.realizedPnlSol = compact(finiteNumber(position.realizedPnlSol, 0) + legPnlSol, 9);
    }
    position.openFraction = compact(Math.max(0, openFraction - fraction), 6);

    const exit = {
      id: stage.id,
      timestamp: nowIso,
      reason: stage.reason || `STAGED_EXIT_${Number(stage.afterMinutes || 0)}M`,
      fraction: compact(fraction, 4),
      remainingFraction: position.openFraction,
      priceUsd: compact(sample.priceUsd, 12),
      returnPct: compact(returnPct, 6),
      pnlUsd: compact(legPnlUsd, 6),
      pnlSol: legPnlSol === null ? null : compact(legPnlSol, 9),
      solUsd: compact(solUsdPrice, 6)
    };

    position.stagedExits = Array.isArray(position.stagedExits) ? position.stagedExits : [];
    position.stagedExits.push(exit);
    position.timeline.push({
      timestamp: nowIso,
      event: 'STAGED_EXIT',
      ...exit
    });
  }
}

function updatePosition(position, market, nowIso, solUsdPrice = null) {
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
  const nextMaxUnrealizedReturnPct = Math.max(Number(position.maxUnrealizedReturnPct || -Infinity), returnPct);
  const breakevenActive = Number(cfg.breakevenActivationPct || 0) > 0
    && nextMaxUnrealizedReturnPct >= Number(cfg.breakevenActivationPct || 0);

  position.currentPriceUsd = compact(priceUsd, 12);
  position.effectiveExitPriceUsd = compact(effectiveExitPriceUsd, 12);
  position.maxPriceUsd = compact(maxPriceUsd, 12);
  position.minPriceUsd = compact(minPriceUsd, 12);
  position.returnPct = compact(returnPct, 6);
  position.maxUnrealizedReturnPct = compact(nextMaxUnrealizedReturnPct, 6);
  position.maxDrawdownPct = compact(entryPriceUsd > 0 ? (minPriceUsd - entryPriceUsd) / entryPriceUsd : 0, 6);
  position.breakevenActivated = Boolean(position.breakevenActivated || breakevenActive);
  position.lastUpdatedAt = nowIso;
  position.updates = Number(position.updates || 0) + 1;

  const sample = {
    timestamp: nowIso,
    event: 'UPDATE',
    priceUsd: compact(priceUsd, 12),
    effectiveExitPriceUsd: compact(effectiveExitPriceUsd, 12),
    returnPct: compact(returnPct, 6),
    pnlUsd: compact(Number(position.nominalUsd || 0) * returnPct, 6),
    pnlSol: position.pnlSol,
    solUsd: compact(solUsdPrice, 6),
    liquidityUsd: market.liquidityUsd ?? null,
    volume1hUsd: market.volume1hUsd ?? null,
    priceChange1hPct: market.priceChange1hPct ?? null
  };
  position.timeline.push(sample);

  let exitReason = null;
  if (returnPct >= Number(cfg.takeProfitPct || 0)) {
    exitReason = 'TAKE_PROFIT';
  } else if (returnPct <= -Number(cfg.stopLossPct || 0)) {
    exitReason = 'STOP_LOSS';
  } else if (position.breakevenActivated && returnPct <= Number(cfg.breakevenStopPct || 0)) {
    exitReason = 'BREAKEVEN_STOP';
  } else if (priceUsd <= trailingStopPriceUsd && Number(position.maxUnrealizedReturnPct || 0) > 0) {
    exitReason = 'TRAILING_STOP';
  } else if (Number.isFinite(holdHours) && holdHours >= Number(cfg.maxHoldHours || 0)) {
    exitReason = 'MAX_HOLD';
  }

  if (!exitReason) {
    executeDueStagedExits(position, nowIso, returnPct, sample, solUsdPrice);
  }

  applyPositionPnl(position, returnPct, solUsdPrice);
  sample.pnlUsd = position.pnlUsd;
  sample.pnlSol = position.pnlSol;
  position.timeline = position.timeline.slice(-100);

  if (exitReason) {
    closePosition(position, nowIso, exitReason);
  } else if (finiteNumber(position.openFraction, 1) <= 0) {
    closePosition(position, nowIso, 'STAGED_EXIT_COMPLETE');
  }
}

function closePosition(position, nowIso, reason) {
  const remainingFraction = finiteNumber(position.openFraction, 1);
  if (remainingFraction > 0) {
    const nominalUsd = finiteNumber(position.nominalUsd, 0);
    const returnPct = finiteNumber(position.returnPct, 0);
    const legPnlUsd = nominalUsd * remainingFraction * returnPct;
    const nominalSol = finiteNumber(position.nominalSol, null);
    const legPnlSol = Number.isFinite(nominalSol) ? nominalSol * remainingFraction * returnPct : null;
    position.realizedPnlUsd = compact(finiteNumber(position.realizedPnlUsd, 0) + legPnlUsd, 6);
    if (legPnlSol !== null) {
      position.realizedPnlSol = compact(finiteNumber(position.realizedPnlSol, 0) + legPnlSol, 9);
    }
    position.openFraction = 0;
    position.pnlUsd = position.realizedPnlUsd;
    position.pnlSol = legPnlSol === null ? position.pnlSol : position.realizedPnlSol;
  }

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
    pnlUsd: position.pnlUsd,
    pnlSol: position.pnlSol,
    solUsd: position.currentSolUsd || position.entrySolUsd || null
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

async function fetchSolUsdPrice() {
  const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`, {
    timeout: 12000,
    headers: { 'User-Agent': 'SpectreContinuationPaper/1.0' }
  });
  const pairs = Array.isArray(response.data?.pairs)
    ? response.data.pairs.filter((pair) => pair?.chainId === 'solana')
    : [];
  const primary = [...pairs].sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
  const price = Number(primary?.priceUsd);
  return Number.isFinite(price) && price > 0 ? price : null;
}

async function resolveSolUsdPrice(args, config) {
  const explicit = finiteNumber(args.solUsd ?? process.env.CONTINUATION_PAPER_SOL_USD);
  if (Number.isFinite(explicit) && explicit > 0) {
    return explicit;
  }

  try {
    const fetched = await fetchSolUsdPrice();
    if (Number.isFinite(fetched) && fetched > 0) {
      return fetched;
    }
  } catch {
    // Keep report generation non-fatal; USD accounting remains canonical.
  }

  const fallback = finiteNumber(config.solUsdFallback);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
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
  skippedChopFade,
  specimenReport,
  internalSpecimenReport,
  combinedSpecimens,
  learningPause,
  solUsdPrice
) {
  const positions = state.positions || [];
  const open = positions.filter((position) => position.status === 'OPEN');
  const closedPositions = positions.filter((position) => position.status === 'CLOSED');
  const closedPnl = closedPositions.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  const openPnl = open.reduce((sum, position) => sum + Number(position.pnlUsd || 0), 0);
  const closedPnlSol = closedPositions.reduce((sum, position) => sum + Number(position.pnlSol || 0), 0);
  const openPnlSol = open.reduce((sum, position) => sum + Number(position.pnlSol || 0), 0);
  const stagedExitEvents = positions.reduce((sum, position) => {
    return sum + (Array.isArray(position.stagedExits) ? position.stagedExits.length : 0);
  }, 0);
  return {
    generatedAt: new Date().toISOString(),
    source: {
      specimenGeneratedAt: specimenReport.generatedAt || null,
      specimenSummary: specimenReport.summary || null,
      internalSpecimenGeneratedAt: internalSpecimenReport.generatedAt || null,
      internalSpecimenSummary: internalSpecimenReport.summary || null,
      combinedSpecimens: combinedSpecimens.length
    },
    solUsdPrice: compact(solUsdPrice, 6),
    summary: {
      openedThisRun: opened.length,
      updatedThisRun: updated.length,
      closedThisRun: closed.length,
      skippedReopenThisRun: skippedReopen.length,
      skippedIneligibleThisRun: skippedIneligible.length,
      skippedLearningThisRun: skippedLearning.length,
      skippedChopFadeThisRun: skippedChopFade.length,
      learningPauseActive: learningPause.active,
      learningRegime: learningPause.marketRegime,
      learningContinuationPosture: learningPause.continuationPosture,
      openPositions: open.length,
      closedPositions: closedPositions.length,
      totalPositions: positions.length,
      stagedExitEvents,
      openPnlUsd: compact(openPnl, 6),
      closedPnlUsd: compact(closedPnl, 6),
      totalMarkedPnlUsd: compact(openPnl + closedPnl, 6),
      openPnlSol: compact(openPnlSol, 9),
      closedPnlSol: compact(closedPnlSol, 9),
      totalMarkedPnlSol: compact(openPnlSol + closedPnlSol, 9),
      exitsByReason: closedPositions.reduce((counts, position) => {
        const reason = position.exitReason || 'UNKNOWN';
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {}),
      positionsByProfile: positions.reduce((counts, position) => {
        const profile = position.paperProfile || 'unknown';
        counts[profile] = (counts[profile] || 0) + 1;
        return counts;
      }, {}),
      openedByProfile: opened.reduce((counts, position) => {
        const profile = position.paperProfile || 'unknown';
        counts[profile] = (counts[profile] || 0) + 1;
        return counts;
      }, {}),
      closedByProfile: closed.reduce((counts, position) => {
        const profile = position.paperProfile || 'unknown';
        counts[profile] = (counts[profile] || 0) + 1;
        return counts;
      }, {})
    },
    opened,
    updated,
    closed,
    skippedReopen,
    skippedIneligible,
    skippedLearning,
    skippedChopFade,
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
  const solUsdPrice = await resolveSolUsdPrice(args, config);
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
  const skippedChopFade = [];

  for (const position of openBefore) {
    const market = markets.get(position.mint);
    updatePosition(position, market, nowIso, solUsdPrice);
    updated.push({
      mint: position.mint,
      symbol: position.symbol,
      paperProfile: position.paperProfile || null,
      status: position.status,
      returnPct: position.returnPct,
      pnlUsd: position.pnlUsd,
      pnlSol: position.pnlSol,
      exitReason: position.exitReason || null
    });
    if (position.status === 'CLOSED') {
      closed.push(position);
    }
  }

  const openMints = new Set(positions.filter((position) => position.status === 'OPEN').map((position) => position.mint));
  const everOpened = new Set(positions.map((position) => position.mint));
  for (const specimen of combinedSpecimens) {
    const chopFade = chopFadeScalperEligibility(specimen, config, learningPause);
    const regularEligible = isEligibleSpecimen(specimen);

    if (openMints.has(specimen.mint)) continue;
    if (!regularEligible && !chopFade.eligible) {
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
      if (chopFade.reason && specimen?.mint) {
        skippedChopFade.push({
          mint: specimen.mint || null,
          symbol: specimen.symbol || null,
          label: specimen.label || null,
          score: compact(specimen.continuationScore, 2),
          reason: chopFade.reason,
          diagnostics: chopFade.diagnostics || null
        });
      }
      continue;
    }

    if (learningPause.active) {
      // During a learning pause, only manage existing paper positions; do not open fresh probes.
      skippedLearning.push({
        mint: specimen.mint,
        symbol: specimen.symbol || null,
        label: specimen.label || null,
        score: compact(specimen.continuationScore, 2),
        reason: learningPause.reason,
        marketRegime: learningPause.marketRegime,
        recommendedPosture: learningPause.recommendedPosture,
        continuationPosture: learningPause.continuationPosture,
        learningGeneratedAt: learningPause.learningGeneratedAt,
        chopFadeEligible: Boolean(chopFade.eligible),
        chopFadeReason: chopFade.reason || null,
        chopFadeDiagnostics: chopFade.diagnostics || null
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
            pnlUsd: position.pnlUsd ?? null,
            paperProfile: position.paperProfile || null
          }))
      });
      continue;
    }
    const profileName = regularEligible ? null : 'chop_fade_scalper';
    const position = openPosition(specimen, config, nowIso, profileName, profileName ? (chopFade.diagnostics || {}) : {}, solUsdPrice);
    positions.push(position);
    openMints.add(specimen.mint);
    everOpened.add(specimen.mint);
    opened.push(position);
  }

  for (const position of positions) {
    applyPositionPnl(position, finiteNumber(position.returnPct, 0), solUsdPrice);
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
    skippedChopFade,
    specimenReport,
    internalSpecimenReport,
    combinedSpecimens,
    learningPause,
    solUsdPrice
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
  console.log(`Skipped chop-fade: ${report.summary.skippedChopFadeThisRun}`);
  console.log(`Combined specimens: ${report.source.combinedSpecimens}`);
  console.log(`Open positions:   ${report.summary.openPositions}`);
  console.log(`Open PnL:         $${report.summary.openPnlUsd}`);
  console.log(`Open PnL SOL:     ${report.summary.openPnlSol} SOL`);
  console.log(`Closed PnL:       $${report.summary.closedPnlUsd}`);
  console.log(`Closed PnL SOL:   ${report.summary.closedPnlSol} SOL`);
  console.log(`Staged exits:     ${report.summary.stagedExitEvents}`);
  console.log(`Profiles:         ${Object.entries(report.summary.positionsByProfile || {}).map(([profile, count]) => `${profile}=${count}`).join(', ') || 'none'}`);

  if (report.learningPause?.active) {
    console.log(
      `Learning pause:   ${report.learningPause.marketRegime || 'unknown'} / ${report.learningPause.continuationPosture || 'unknown'}`
    );
  }

  if (report.opened.length > 0) {
    console.log('\nOpened');
    for (const position of report.opened) {
      console.log(`  ${position.symbol || position.mint}: ${position.paperProfile || 'unknown'} ${position.sourceLabel} entry=$${position.entryPriceUsd} score=${position.entryScore}`);
    }
  }

  if (report.updated.length > 0) {
    console.log('\nUpdated');
    for (const item of report.updated) {
      const exit = item.exitReason ? ` exit=${item.exitReason}` : '';
      console.log(`  ${item.symbol || item.mint}: ${item.paperProfile || 'unknown'} ${item.status} return=${item.returnPct} pnl=${item.pnlSol} SOL ($${item.pnlUsd})${exit}`);
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
