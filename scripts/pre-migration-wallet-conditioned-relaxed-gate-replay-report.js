#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-conditioned-relaxed-gate-replay-latest.json');
const STABILITY_OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-conditioned-slice-stability-latest.json');
const RELAXED_REPLAY_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-relaxed-gate-replay-latest.json');
const WALLET_FALSE_NEGATIVE_BRIDGE_PATH = path.join(ROOT, 'data', 'reports', 'wallet-false-negative-bridge-latest.json');
const WALLET_PAPER_ENTRY_CONDITIONAL_PATH = path.join(ROOT, 'data', 'reports', 'wallet-paper-entry-conditional-latest.json');
const WALLET_PROMOTION_REVIEW_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const WALLET_LAUNCH_INTEL_STABILITY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-launch-intel-stability-latest.json');
const WALLET_EVENTS_PATH = path.join(ROOT, 'data', 'wallet-events', 'events.jsonl');
const FROZEN_STABILITY_SLICE = 'all_low_score_first_sight__tracked_first_touch_buy';

const POSITIVE_EVIDENCE_TIERS = new Set(['PROVEN_POSITIVE', 'PROMISING_POSITIVE']);
const POSITIVE_REVIEW_TIERS = new Set(['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE']);
const AVOID_REVIEW_TIERS = new Set(['AVOID_REVIEW']);
const AVOID_EVIDENCE_TIERS = new Set(['NEGATIVE_EVIDENCE']);
const STRESS_EXTRA_SLIPPAGE_PCT = 1.5;
const FEE_STRESS_SCENARIOS = [
  {
    name: 'existing_extra_slippage_1_5pct',
    description: 'Existing report-only stress haircut: subtracts 1.5 percentage points from netReturnPct.',
    extraReturnPct: STRESS_EXTRA_SLIPPAGE_PCT,
    fixedSolPerTrade: 0
  },
  {
    name: 'fee_slippage_priority_conservative',
    description: 'Report-only conservative live-ish haircut: 1% pump.fun fee proxy + 1.5% curve/slippage + 0.00005 SOL priority/landing cost per trade.',
    extraReturnPct: 2.5,
    fixedSolPerTrade: 0.00005
  }
];

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      return JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function numberOrNull(value, digits = null) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return digits === null ? number : Number(number.toFixed(digits));
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function canonicalName(name, walletAddress) {
  const label = String(name || walletAddress || '').trim();
  if (/^Cupsey(?:\s+\d+)?$/i.test(label)) return 'Cupsey';
  return label || walletAddress || null;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}

function uniqueCount(items, keyFn) {
  return new Set(items.map(keyFn).filter(Boolean)).size;
}

function normalizeTouch(touch) {
  const touchAtMs = timestampMs(touch.touchAt);
  return {
    source: touch.source || 'wallet_false_negative_bridge',
    canonicalWallet: touch.canonicalWallet || touch.wallet || touch.walletAddress || null,
    side: touch.side || null,
    reviewTier: touch.reviewTierAtRun || touch.reviewTier || null,
    evidenceTier: touch.evidenceTier || null,
    launchIntelClassification: touch.launchIntelClassification || null,
    launchIntelScore: numberOrNull(touch.launchIntelScore, 2),
    leadClass: touch.leadClass || null,
    touchAt: touch.touchAt || null,
    touchAtMs,
    curveProgress: numberOrNull(touch.curveProgress),
    secondsTouchTo85: numberOrNull(touch.secondsTouchTo85, 3),
    secondsTouchTo95: numberOrNull(touch.secondsTouchTo95, 3)
  };
}

function eventType(event) {
  return event?.type || event?.event || event?.name || 'unknown';
}

function payloadOf(event) {
  return event?.payload || event?.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function walletOf(payload) {
  return payload.wallet || payload.walletAddress || payload.traderPublicKey || payload.account || payload.address || null;
}

function curveOf(payload) {
  const raw = payload.providerCurveProgress
    ?? payload.curveProgress
    ?? payload.bondingCurveProgress
    ?? payload.paperCurveProgress
    ?? payload.progress;
  const curve = Number(raw);
  if (!Number.isFinite(curve)) return null;
  return curve > 1 && curve <= 100 ? curve / 100 : curve;
}

function isPre85Touch(touch) {
  if (!touch) return false;
  if (touch.leadClass === 'BEFORE_85') return true;
  if (touch.leadClass === 'BEFORE_FIRST_FLAG') return true;
  if (Number.isFinite(Number(touch.curveProgress)) && Number(touch.curveProgress) < 0.85) return true;
  return Number.isFinite(Number(touch.secondsTouchTo85)) && Number(touch.secondsTouchTo85) > 0;
}

function isPreEntryTouch(touch, trade) {
  const entryMs = timestampMs(trade.entryAt);
  if (!Number.isFinite(entryMs) || !Number.isFinite(touch.touchAtMs)) return isPre85Touch(touch);
  return touch.touchAtMs <= entryMs;
}

function isConditioningTouch(touch, trade) {
  return isPre85Touch(touch) || isPreEntryTouch(touch, trade);
}

function isAvoidTouch(touch) {
  return AVOID_REVIEW_TIERS.has(touch.reviewTier) || AVOID_EVIDENCE_TIERS.has(touch.evidenceTier);
}

function isAvoidReviewTouch(touch) {
  return AVOID_REVIEW_TIERS.has(touch?.reviewTier);
}

function isNegativeEvidenceTouch(touch) {
  return AVOID_EVIDENCE_TIERS.has(touch?.evidenceTier);
}

function isPositiveTouch(touch) {
  return POSITIVE_EVIDENCE_TIERS.has(touch.evidenceTier) || POSITIVE_REVIEW_TIERS.has(touch.reviewTier);
}

function buildBridgeByMint(bridge) {
  const byMint = new Map();
  const rows = Array.isArray(bridge?.rows) ? bridge.rows : [];
  for (const row of rows) {
    if (!row?.mint) continue;
    byMint.set(row.mint, {
      mint: row.mint,
      symbol: row.symbol || null,
      walletLedMiss: Boolean(row.walletLedMiss),
      strongWalletLedMiss: Boolean(row.strongWalletLedMiss),
      leadWallets: Array.isArray(row.leadWallets) ? row.leadWallets : [],
      strongLeadWallets: Array.isArray(row.strongLeadWallets) ? row.strongLeadWallets : [],
      touches: Array.isArray(row.touches) ? row.touches.map(normalizeTouch) : []
    });
  }
  return byMint;
}

function buildPromotionIndex(promotion) {
  const byAddress = new Map();
  const byName = new Map();
  const addRows = (rows) => {
    for (const row of rows || []) {
      const meta = {
        name: row.name || null,
        walletAddress: row.walletAddress || null,
        reviewTier: row.reviewTier || null,
        evidenceTier: row.evidenceTier || null
      };
      if (meta.walletAddress) byAddress.set(meta.walletAddress, meta);
      const canonical = canonicalName(meta.name, meta.walletAddress);
      if (canonical) byName.set(canonical, meta);
    }
  };
  addRows(promotion.trustReview);
  addRows(promotion.profitableNeedsFirstTouchEvidence);
  addRows(promotion.watchReview);
  addRows(promotion.avoidReview);
  addRows(promotion.hold);
  return { byAddress, byName };
}

function buildWalletEventTouchesByMint(walletEvents, promotionIndex) {
  const firstByWalletMint = new Map();
  for (const event of walletEvents) {
    if (!event?.mint || !event.wallet) continue;
    const canonicalWallet = canonicalName(event.walletProfile?.name, event.wallet);
    const key = `${canonicalWallet}:${event.mint}`;
    const touchAt = event.tradeAt || event.observedAt || null;
    const prior = firstByWalletMint.get(key);
    if (prior && timestampMs(prior.touchAt) <= timestampMs(touchAt)) continue;
    const meta = promotionIndex.byAddress.get(event.wallet) || promotionIndex.byName.get(canonicalWallet) || {};
    firstByWalletMint.set(key, {
      source: 'wallet_event_ledger',
      mint: event.mint,
      canonicalWallet,
      walletAddress: event.wallet,
      touchAt,
      side: event.side || null,
      reviewTier: meta.reviewTier || null,
      evidenceTier: meta.evidenceTier || null,
      leadClass: Number(event.market?.curveProgress) < 0.85 || event.phase === 'fresh_launch' ? 'BEFORE_85' : 'AFTER_85_OR_UNKNOWN',
      curveProgress: numberOrNull(event.market?.curveProgress),
      secondsTouchTo85: null,
      secondsTouchTo95: null
    });
  }

  const byMint = new Map();
  for (const touch of firstByWalletMint.values()) {
    if (!byMint.has(touch.mint)) byMint.set(touch.mint, []);
    byMint.get(touch.mint).push(normalizeTouch(touch));
  }
  return byMint;
}

function buildLaunchIntelShortlistIndex(stability) {
  const byWallet = new Map();
  for (const row of stability?.repeatShortlistCandidates || []) {
    if (!row?.wallet) continue;
    byWallet.set(row.wallet, {
      wallet: row.wallet,
      classification: row.classification || 'REPEAT_SHORTLIST_CANDIDATE',
      score: numberOrNull(row.score, 2),
      runCount: row.runCount ?? null,
      decisionRunCount: row.decisionRunCount ?? null,
      noTrackedFirstTouchLinks: row.noTrackedFirstTouchLinks ?? null,
      launchIntel: row.launchIntel || null
    });
  }
  return byWallet;
}

function buildLaunchIntelTouchesByMint(stability) {
  const shortlistByWallet = buildLaunchIntelShortlistIndex(stability);
  const telemetryFiles = Array.isArray(stability?.sources?.telemetryFiles) ? stability.sources.telemetryFiles : [];
  const firstByWalletMint = new Map();
  for (const filePath of telemetryFiles) {
    const events = readJsonl(path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath));
    for (const event of events) {
      if (eventType(event) !== 'wallet.trade_gate_diagnostic') continue;
      const payload = payloadOf(event);
      if ((payload.dropReason || 'unknown') !== 'UNTRACKED_WALLET') continue;
      if (String(payload.txType || '').toLowerCase() !== 'buy') continue;
      const wallet = walletOf(payload);
      const mint = mintOf(payload);
      const meta = shortlistByWallet.get(wallet);
      if (!meta || !mint) continue;
      const touchAt = payload.timestamp || event.timestamp || null;
      const key = `${wallet}:${mint}`;
      const prior = firstByWalletMint.get(key);
      if (prior && timestampMs(prior.touchAt) <= timestampMs(touchAt)) continue;
      firstByWalletMint.set(key, {
        source: 'launch_intel_stability_shortlist',
        mint,
        canonicalWallet: wallet,
        walletAddress: wallet,
        touchAt,
        side: 'buy',
        reviewTier: 'LAUNCH_INTEL_SHORTLIST',
        evidenceTier: null,
        launchIntelClassification: meta.classification,
        launchIntelScore: meta.score,
        leadClass: Number(curveOf(payload)) < 0.85 ? 'BEFORE_85' : 'AFTER_85_OR_UNKNOWN',
        curveProgress: numberOrNull(curveOf(payload)),
        secondsTouchTo85: null,
        secondsTouchTo95: null,
        launchIntel: meta.launchIntel,
        runCount: meta.runCount,
        decisionRunCount: meta.decisionRunCount,
        noTrackedFirstTouchLinks: meta.noTrackedFirstTouchLinks
      });
    }
  }

  const byMint = new Map();
  for (const touch of firstByWalletMint.values()) {
    if (!byMint.has(touch.mint)) byMint.set(touch.mint, []);
    byMint.get(touch.mint).push(normalizeTouch(touch));
  }
  return byMint;
}

function buildPaperConditionalByMint(report) {
  const byMint = new Map();
  const addSample = (sample, source) => {
    if (!sample?.mint) return;
    if (!byMint.has(sample.mint)) byMint.set(sample.mint, []);
    byMint.get(sample.mint).push({
      source,
      symbol: sample.symbol || null,
      reviewTier: sample.reviewTierAtRun || sample.reviewTier || null,
      outcome: sample.outcome || null,
      pnlSol: numberOrNull(sample.pnlSol)
    });
  };

  const walk = (value, source = 'unknown') => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, source);
      return;
    }
    if (Array.isArray(value.sampleMints)) {
      for (const sample of value.sampleMints) addSample(sample, source);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'sampleMints') continue;
      if (child && typeof child === 'object') walk(child, key);
    }
  };

  walk(report, 'wallet-paper-entry-conditional');
  return byMint;
}

function mergeTouches(touches) {
  const byWallet = new Map();
  for (const touch of touches) {
    const key = touch.canonicalWallet || `${touch.source}:${touch.touchAt}`;
    const prior = byWallet.get(key);
    if (!prior || (Number.isFinite(touch.touchAtMs) && touch.touchAtMs < prior.touchAtMs)) {
      byWallet.set(key, touch);
    }
  }
  return [...byWallet.values()].sort((a, b) => (a.touchAtMs || 0) - (b.touchAtMs || 0));
}

function annotationsForTrade(trade, bridgeByMint, walletEventTouchesByMint, launchIntelTouchesByMint, paperConditionalByMint) {
  const bridge = bridgeByMint.get(trade.mint) || null;
  const touches = mergeTouches([
    ...(bridge?.touches || []),
    ...(walletEventTouchesByMint.get(trade.mint) || []),
    ...(launchIntelTouchesByMint.get(trade.mint) || [])
  ]);
  const conditioningTouches = touches.filter((touch) => isConditioningTouch(touch, trade));
  const positiveTouches = conditioningTouches.filter(isPositiveTouch);
  const launchIntelShortlistTouches = conditioningTouches.filter((touch) => touch.reviewTier === 'LAUNCH_INTEL_SHORTLIST');
  const avoidTouches = conditioningTouches.filter(isAvoidTouch);
  const holdTouches = conditioningTouches.filter((touch) => touch.reviewTier === 'HOLD');
  const provenPositiveTouches = conditioningTouches.filter((touch) => touch.evidenceTier === 'PROVEN_POSITIVE');
  const profitableNeedsFirstTouchTouches = conditioningTouches.filter((touch) => touch.reviewTier === 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE');
  const firstTouch = conditioningTouches
    .filter((touch) => Number.isFinite(touch.touchAtMs))
    .sort((a, b) => a.touchAtMs - b.touchAtMs)[0] || null;
  const paperConditional = paperConditionalByMint.get(trade.mint) || [];
  return {
    bridge,
    touches,
    conditioningTouches,
    positiveTouches,
    launchIntelShortlistTouches,
    avoidTouches,
    holdTouches,
    provenPositiveTouches,
    profitableNeedsFirstTouchTouches,
    firstTouch,
    paperConditional
  };
}

function stressedPnlForTrade(trade, baseAmountSol) {
  const netReturnPct = Number(trade.netReturnPct);
  if (Number.isFinite(netReturnPct)) {
    return baseAmountSol * ((netReturnPct - STRESS_EXTRA_SLIPPAGE_PCT) / 100);
  }
  const pnl = Number(trade.pnlSol);
  return Number.isFinite(pnl) ? pnl - (baseAmountSol * (STRESS_EXTRA_SLIPPAGE_PCT / 100)) : 0;
}

function summarizeSlice(name, description, trades, baseAmountSol) {
  const sorted = [...trades].sort((a, b) => timestampMs(a.entryAt) - timestampMs(b.entryAt));
  const pnlValues = sorted.map((trade) => Number(trade.pnlSol)).filter(Number.isFinite);
  const stressedPnlValues = sorted.map((trade) => stressedPnlForTrade(trade, baseAmountSol));
  const totalPnlSol = pnlValues.reduce((total, value) => total + value, 0);
  const stressedPnlSol = stressedPnlValues.reduce((total, value) => total + value, 0);
  const wins = pnlValues.filter((value) => value > 0).length;
  const losses = pnlValues.filter((value) => value < 0).length;
  const midpoint = Math.ceil(sorted.length / 2);
  const firstHalf = sorted.slice(0, midpoint);
  const secondHalf = sorted.slice(midpoint);
  const sumPnl = (items) => items.reduce((total, trade) => total + (Number(trade.pnlSol) || 0), 0);
  const top3Pnl = [...pnlValues].sort((a, b) => b - a).slice(0, 3).reduce((total, value) => total + value, 0);
  const top3RemovedPnlSol = totalPnlSol - top3Pnl;
  const crossed90ByExit = sorted.filter((trade) => Number(trade.exitCurveProgress) >= 0.9).length;
  const sampleTrades = sorted.slice(0, 12).map((trade) => ({
    mint: trade.mint,
    symbol: trade.symbol || null,
    entryAt: trade.entryAt,
    reasonAtEntry: trade.reasonAtEntry || null,
    entryCurveProgress: numberOrNull(trade.entryCurveProgress, 4),
    score: numberOrNull(trade.score, 2),
    exitReason: trade.exitReason || null,
    pnlSol: numberOrNull(trade.pnlSol, 9),
    walletLedMiss: Boolean(trade.walletConditioning?.bridge?.walletLedMiss),
    touchSummary: trade.walletConditioning?.touchSummary || {}
  }));

  const shadowLaneEligible = sorted.length >= 60
    && totalPnlSol > 0
    && stressedPnlSol > 0
    && (wins / Math.max(1, pnlValues.length)) >= 0.45
    && sumPnl(firstHalf) > 0
    && sumPnl(secondHalf) > 0
    && top3RemovedPnlSol > 0;

  let verdict = 'INSUFFICIENT_SAMPLE';
  if (sorted.length >= 10) {
    if (totalPnlSol <= 0 || stressedPnlSol <= 0) verdict = 'NEGATIVE';
    else if (shadowLaneEligible) verdict = 'PROMISING';
    else verdict = 'INCONCLUSIVE';
  }

  return {
    name,
    description,
    verdict,
    shadowLaneEligible,
    trades: sorted.length,
    uniqueMints: uniqueCount(sorted, (trade) => trade.mint),
    wins,
    losses,
    winRate: sorted.length ? numberOrNull(wins / sorted.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    averagePnlSol: sorted.length ? numberOrNull(totalPnlSol / sorted.length, 9) : null,
    stressedPnlSol: numberOrNull(stressedPnlSol, 9),
    firstHalfPnlSol: numberOrNull(sumPnl(firstHalf), 9),
    secondHalfPnlSol: numberOrNull(sumPnl(secondHalf), 9),
    top3RemovedPnlSol: numberOrNull(top3RemovedPnlSol, 9),
    crossed90ByExit,
    exitReasonCounts: countBy(sorted, (trade) => trade.exitReason),
    touchTierCounts: countBy(sorted.flatMap((trade) => trade.walletConditioning?.conditioningTouches || []), (touch) => touch.reviewTier || touch.evidenceTier),
    evidenceTierCounts: countBy(sorted.flatMap((trade) => trade.walletConditioning?.conditioningTouches || []), (touch) => touch.evidenceTier),
    sampleTrades
  };
}

function decorateTrade(trade, bridgeByMint, walletEventTouchesByMint, launchIntelTouchesByMint, paperConditionalByMint) {
  const annotation = annotationsForTrade(trade, bridgeByMint, walletEventTouchesByMint, launchIntelTouchesByMint, paperConditionalByMint);
  return {
    ...trade,
    walletConditioning: {
      bridge: annotation.bridge ? {
        walletLedMiss: annotation.bridge.walletLedMiss,
        strongWalletLedMiss: annotation.bridge.strongWalletLedMiss,
        leadWallets: annotation.bridge.leadWallets,
        strongLeadWallets: annotation.bridge.strongLeadWallets
      } : null,
      touches: annotation.touches,
      conditioningTouches: annotation.conditioningTouches,
      firstTouch: annotation.firstTouch,
      paperConditional: annotation.paperConditional,
      touchSummary: {
        touches: annotation.touches.length,
        conditioningTouches: annotation.conditioningTouches.length,
        positiveTouches: annotation.positiveTouches.length,
        launchIntelShortlistTouches: annotation.launchIntelShortlistTouches.length,
        avoidTouches: annotation.avoidTouches.length,
        holdTouches: annotation.holdTouches.length,
        provenPositiveTouches: annotation.provenPositiveTouches.length,
        profitableNeedsFirstTouchTouches: annotation.profitableNeedsFirstTouchTouches.length
      }
    }
  };
}

function buildSlices(profileName, trades) {
  return [
    {
      condition: 'baseline',
      name: `${profileName}__baseline`,
      profileName,
      description: `Unconditioned ${profileName} relaxed-gate replay baseline.`,
      trades
    },
    {
      condition: 'exclude_avoid_or_negative_touch',
      name: `${profileName}__exclude_avoid_or_negative_touch`,
      profileName,
      description: `${profileName} excluding mints with pre-entry/pre-85 AVOID_REVIEW or NEGATIVE_EVIDENCE touches.`,
      trades: trades.filter((trade) => (trade.walletConditioning?.touchSummary?.avoidTouches || 0) === 0)
    },
    {
      condition: 'hold_pre85_touch',
      name: `${profileName}__hold_pre85_touch`,
      profileName,
      description: `${profileName} requiring at least one pre-entry/pre-85 HOLD-tier wallet touch.`,
      trades: trades.filter((trade) => (trade.walletConditioning?.touchSummary?.holdTouches || 0) >= 1)
    },
    {
      condition: 'proven_positive_pre85_touch',
      name: `${profileName}__proven_positive_pre85_touch`,
      profileName,
      description: `${profileName} requiring at least one pre-entry/pre-85 PROVEN_POSITIVE wallet touch.`,
      trades: trades.filter((trade) => (trade.walletConditioning?.touchSummary?.provenPositiveTouches || 0) >= 1)
    },
    {
      condition: 'profitable_needs_first_touch_pre85',
      name: `${profileName}__profitable_needs_first_touch_pre85`,
      profileName,
      description: `${profileName} requiring at least one pre-entry/pre-85 PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE touch.`,
      trades: trades.filter((trade) => (trade.walletConditioning?.touchSummary?.profitableNeedsFirstTouchTouches || 0) >= 1)
    },
    {
      condition: 'wallet_led_false_negative_bridge',
      name: `${profileName}__wallet_led_false_negative_bridge`,
      profileName,
      description: `${profileName} requiring mint match to wallet-led false-negative bridge.`,
      trades: trades.filter((trade) => Boolean(trade.walletConditioning?.bridge?.walletLedMiss))
    },
    {
      condition: 'strong_wallet_led_false_negative_bridge',
      name: `${profileName}__strong_wallet_led_false_negative_bridge`,
      profileName,
      description: `${profileName} requiring mint match to strong wallet-led false-negative bridge.`,
      trades: trades.filter((trade) => Boolean(trade.walletConditioning?.bridge?.strongWalletLedMiss))
    },
    {
      condition: 'two_plus_positive_or_proven_touches',
      name: `${profileName}__two_plus_positive_or_proven_touches`,
      profileName,
      description: `${profileName} requiring at least two distinct positive/proven pre-entry/pre-85 wallet touches.`,
      trades: trades.filter((trade) => {
        const wallets = new Set((trade.walletConditioning?.conditioningTouches || [])
          .filter(isPositiveTouch)
          .map((touch) => touch.canonicalWallet)
          .filter(Boolean));
        return wallets.size >= 2;
      })
    },
    {
      condition: 'positive_or_proven_first_touch_buy',
      name: `${profileName}__positive_or_proven_first_touch_buy`,
      profileName,
      description: `${profileName} requiring earliest pre-entry/pre-85 touch to be a buy from a positive/proven wallet.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy' && isPositiveTouch(first);
      })
    },
    {
      condition: 'tracked_first_touch_buy',
      name: `${profileName}__tracked_first_touch_buy`,
      profileName,
      description: `${profileName} requiring earliest pre-entry/pre-85 touch to be a buy from any tracked wallet.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy';
      })
    },
    {
      condition: 'tracked_first_touch_buy_avoid_only',
      name: `${profileName}__tracked_first_touch_buy_avoid_only`,
      profileName,
      description: `${profileName} positive-control slice requiring earliest pre-entry/pre-85 touch to be a buy from an AVOID_REVIEW wallet.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy' && isAvoidReviewTouch(first);
      })
    },
    {
      condition: 'tracked_first_touch_buy_negative_only',
      name: `${profileName}__tracked_first_touch_buy_negative_only`,
      profileName,
      description: `${profileName} positive-control slice requiring earliest pre-entry/pre-85 touch to be a buy from a NEGATIVE_EVIDENCE wallet.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy' && isNegativeEvidenceTouch(first);
      })
    },
    {
      condition: 'tracked_first_touch_buy_exclude_avoid',
      name: `${profileName}__tracked_first_touch_buy_exclude_avoid`,
      profileName,
      description: `${profileName} requiring earliest pre-entry/pre-85 touch to be a tracked-wallet buy and excluding AVOID/NEGATIVE touches.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy' && (trade.walletConditioning?.touchSummary?.avoidTouches || 0) === 0;
      })
    },
    {
      condition: 'launch_intel_shortlist_first_touch_buy',
      name: `${profileName}__launch_intel_shortlist_first_touch_buy`,
      profileName,
      description: `${profileName} requiring earliest pre-entry/pre-85 touch to be a launch-intel shortlist wallet buy.`,
      trades: trades.filter((trade) => {
        const first = trade.walletConditioning?.firstTouch;
        return first && first.side === 'buy' && first.reviewTier === 'LAUNCH_INTEL_SHORTLIST';
      })
    },
    {
      condition: 'launch_intel_shortlist_touch_exclude_avoid',
      name: `${profileName}__launch_intel_shortlist_touch_exclude_avoid`,
      profileName,
      description: `${profileName} requiring a pre-entry/pre-85 launch-intel shortlist touch and excluding AVOID/NEGATIVE touches.`,
      trades: trades.filter((trade) => (
        (trade.walletConditioning?.touchSummary?.launchIntelShortlistTouches || 0) >= 1
        && (trade.walletConditioning?.touchSummary?.avoidTouches || 0) === 0
      ))
    },
    {
      condition: 'trust_review_positive_control',
      name: `${profileName}__trust_review_positive_control`,
      profileName,
      description: `${profileName} control slice requiring at least one TRUST_REVIEW pre-entry/pre-85 touch.`,
      trades: trades.filter((trade) => (trade.walletConditioning?.conditioningTouches || []).some((touch) => touch.reviewTier === 'TRUST_REVIEW'))
    }
  ];
}

function summarizeConditionLift(profileName, baseline, conditioned) {
  const pnlDelta = Number(conditioned?.totalPnlSol || 0) - Number(baseline?.totalPnlSol || 0);
  const stressedDelta = Number(conditioned?.stressedPnlSol || 0) - Number(baseline?.stressedPnlSol || 0);
  const winRateDelta = Number(conditioned?.winRate || 0) - Number(baseline?.winRate || 0);
  return {
    profileName,
    baselineTrades: baseline?.trades ?? 0,
    conditionedTrades: conditioned?.trades ?? 0,
    removedTrades: Number(baseline?.trades || 0) - Number(conditioned?.trades || 0),
    baselinePnlSol: baseline?.totalPnlSol ?? null,
    conditionedPnlSol: conditioned?.totalPnlSol ?? null,
    pnlDeltaSol: numberOrNull(pnlDelta, 9),
    baselineStressedPnlSol: baseline?.stressedPnlSol ?? null,
    conditionedStressedPnlSol: conditioned?.stressedPnlSol ?? null,
    stressedDeltaSol: numberOrNull(stressedDelta, 9),
    baselineWinRate: baseline?.winRate ?? null,
    conditionedWinRate: conditioned?.winRate ?? null,
    winRateDelta: numberOrNull(winRateDelta, 4),
    baselineVerdict: baseline?.verdict || null,
    conditionedVerdict: conditioned?.verdict || null
  };
}

function quantile(values, q) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function scenarioPnlForTrade(trade, baseAmountSol, scenario) {
  const netReturnPct = Number(trade.netReturnPct);
  if (Number.isFinite(netReturnPct)) {
    return (baseAmountSol * ((netReturnPct - scenario.extraReturnPct) / 100)) - Number(scenario.fixedSolPerTrade || 0);
  }
  const pnl = Number(trade.pnlSol);
  return Number.isFinite(pnl)
    ? pnl - (baseAmountSol * (scenario.extraReturnPct / 100)) - Number(scenario.fixedSolPerTrade || 0)
    : 0;
}

function telemetryRunKey(trade) {
  const value = String(trade.telemetryPath || 'unknown');
  return value.split(/[\\/]/).pop() || value;
}

function tradeRunDate(trade) {
  const entryMs = timestampMs(trade.entryAt);
  if (Number.isFinite(entryMs)) return new Date(entryMs).toISOString().slice(0, 10);
  const match = telemetryRunKey(trade).match(/telemetry-(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : 'unknown';
}

function eraForTrade(trade) {
  const date = tradeRunDate(trade);
  if (date === 'unknown') return 'unknown';
  if (date < '2026-07-01') return 'pre_july_backfill';
  if (date < '2026-07-07') return 'july_pre_lane_input';
  return 'lane_input_era';
}

function summarizeTradeSet(trades, baseAmountSol) {
  const pnls = trades.map((trade) => Number(trade.pnlSol)).filter(Number.isFinite);
  const totalPnlSol = pnls.reduce((sum, value) => sum + value, 0);
  const wins = pnls.filter((value) => value > 0).length;
  const losses = pnls.filter((value) => value < 0).length;
  const sortedDesc = pnls.slice().sort((a, b) => b - a);
  const top3Pnl = sortedDesc.slice(0, 3).reduce((sum, value) => sum + value, 0);
  const scenarioPnl = Object.fromEntries(FEE_STRESS_SCENARIOS.map((scenario) => [
    scenario.name,
    numberOrNull(trades.reduce((sum, trade) => sum + scenarioPnlForTrade(trade, baseAmountSol, scenario), 0), 9)
  ]));
  return {
    trades: trades.length,
    uniqueMints: uniqueCount(trades, (trade) => trade.mint),
    wins,
    losses,
    winRate: trades.length ? numberOrNull(wins / trades.length, 4) : null,
    totalPnlSol: numberOrNull(totalPnlSol, 9),
    medianPnlSol: numberOrNull(quantile(pnls, 0.5), 9),
    averagePnlSol: trades.length ? numberOrNull(totalPnlSol / trades.length, 9) : null,
    pnlAfterRemovingTop3WinnersSol: numberOrNull(totalPnlSol - top3Pnl, 9),
    scenarioPnlSol: scenarioPnl,
    exitReasonCounts: countBy(trades, (trade) => trade.exitReason || 'unknown')
  };
}

function groupTrades(trades, keyFn) {
  const groups = new Map();
  for (const trade of trades) {
    const key = keyFn(trade) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return groups;
}

function summarizeGroups(trades, keyFn, baseAmountSol) {
  return [...groupTrades(trades, keyFn).entries()]
    .map(([key, rows]) => ({ key, ...summarizeTradeSet(rows, baseAmountSol) }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function stabilityGate(overall, perRun) {
  const runsWithTrades = perRun.filter((row) => row.trades > 0);
  const positiveRuns = runsWithTrades.filter((row) => Number(row.totalPnlSol || 0) > 0);
  const totalPnl = Number(overall.totalPnlSol || 0);
  const largestRunPnl = runsWithTrades.reduce((max, row) => Math.max(max, Number(row.totalPnlSol || 0)), Number.NEGATIVE_INFINITY);
  const largestRunShareOfTotal = totalPnl > 0 && Number.isFinite(largestRunPnl)
    ? largestRunPnl / totalPnl
    : null;
  const checks = {
    positiveOrNonNegativeRunsAtLeast3: positiveRuns.length >= 3 || runsWithTrades.filter((row) => Number(row.totalPnlSol || 0) >= 0).length >= 3,
    positiveRunsAtLeast3: positiveRuns.length >= 3,
    noSingleRunOver60PctOfTotalPnl: largestRunShareOfTotal === null ? false : largestRunShareOfTotal <= 0.6,
    totalPnlPositive: totalPnl > 0,
    stressedPnlPositive: Number(overall.scenarioPnlSol?.existing_extra_slippage_1_5pct || 0) > 0,
    conservativeFeePnlPositive: Number(overall.scenarioPnlSol?.fee_slippage_priority_conservative || 0) > 0
  };
  return {
    verdict: Object.values(checks).every(Boolean) ? 'STABILITY_PASSED_FREEZE_SHADOW_NEXT' : 'STABILITY_NOT_PROVEN',
    checks,
    runsWithTrades: runsWithTrades.length,
    positiveRuns: positiveRuns.length,
    nonNegativeRuns: runsWithTrades.filter((row) => Number(row.totalPnlSol || 0) >= 0).length,
    largestRunPnlSol: Number.isFinite(largestRunPnl) ? numberOrNull(largestRunPnl, 9) : null,
    largestRunShareOfTotalPnl: largestRunShareOfTotal === null ? null : numberOrNull(largestRunShareOfTotal, 4)
  };
}

function buildFrozenSliceStability(slice, baseAmountSol) {
  const trades = (slice?.trades || []).slice().sort((a, b) => timestampMs(a.entryAt) - timestampMs(b.entryAt));
  const overall = summarizeTradeSet(trades, baseAmountSol);
  const perRun = summarizeGroups(trades, telemetryRunKey, baseAmountSol).map((row) => ({
    ...row,
    runDate: tradeRunDate(trades.find((trade) => telemetryRunKey(trade) === row.key) || {}),
    era: eraForTrade(trades.find((trade) => telemetryRunKey(trade) === row.key) || {})
  }));
  const perEra = summarizeGroups(trades, eraForTrade, baseAmountSol);
  const perDate = summarizeGroups(trades, tradeRunDate, baseAmountSol);
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_conditioned_frozen_slice_stability',
    note: 'Report-only stability drilldown for the frozen wallet-conditioned slice before any runtime shadow lane is added. Does not alter runtime gates, entries, exits, scoring, sizing, AI review, broadcasts, or live behavior.',
    frozenHypothesis: {
      name: FROZEN_STABILITY_SLICE,
      profileName: slice?.profileName || 'all_low_score_first_sight',
      condition: slice?.condition || 'tracked_first_touch_buy',
      rule: 'Earliest pre-entry/pre-85 tracked wallet touch must be a buy. Profile and condition are frozen from the existing replay output; do not retune before OOS collection.'
    },
    feeStressScenarios: FEE_STRESS_SCENARIOS,
    criteria: {
      proceedToShadowLane: 'Require positive or at least non-negative total in >=3 covered runs, >=3 positive runs for the strict check, no single run contributing >60% of total PnL, positive total PnL, positive existing stressed PnL, and positive conservative fee/slippage/priority PnL.',
      nextIfPass: 'Pre-register exactly this slice as a paper-only runtime shadow lane.',
      nextIfFail: 'Do not add the runtime shadow lane yet; inspect concentration/fee failure first.'
    },
    summary: overall,
    stability: stabilityGate(overall, perRun),
    perRun,
    perEra,
    perDate,
    topRunContributors: perRun.slice().sort((a, b) => Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0)).slice(0, 10),
    worstRunContributors: perRun.slice().sort((a, b) => Number(a.totalPnlSol || 0) - Number(b.totalPnlSol || 0)).slice(0, 10),
    sampleTrades: trades.slice(0, 20).map((trade) => ({
      telemetryPath: trade.telemetryPath || null,
      mint: trade.mint,
      symbol: trade.symbol || null,
      entryAt: trade.entryAt || null,
      exitAt: trade.exitAt || null,
      entryCurveProgress: numberOrNull(trade.entryCurveProgress, 4),
      score: numberOrNull(trade.score, 2),
      exitReason: trade.exitReason || null,
      pnlSol: numberOrNull(trade.pnlSol, 9),
      netReturnPct: numberOrNull(trade.netReturnPct, 4),
      firstTouch: trade.walletConditioning?.firstTouch ? {
        source: trade.walletConditioning.firstTouch.source || null,
        canonicalWallet: trade.walletConditioning.firstTouch.canonicalWallet || null,
        side: trade.walletConditioning.firstTouch.side || null,
        reviewTier: trade.walletConditioning.firstTouch.reviewTier || null,
        evidenceTier: trade.walletConditioning.firstTouch.evidenceTier || null,
        touchAt: trade.walletConditioning.firstTouch.touchAt || null,
        curveProgress: numberOrNull(trade.walletConditioning.firstTouch.curveProgress, 4)
      } : null
    }))
  };
}

function main() {
  const relaxedReplay = readJson(RELAXED_REPLAY_PATH, {});
  const bridge = readJson(WALLET_FALSE_NEGATIVE_BRIDGE_PATH, {});
  const paperConditional = readJson(WALLET_PAPER_ENTRY_CONDITIONAL_PATH, {});
  const promotion = readJson(WALLET_PROMOTION_REVIEW_PATH, {});
  const launchIntelStability = readJson(WALLET_LAUNCH_INTEL_STABILITY_PATH, {});
  const walletEvents = readJsonl(WALLET_EVENTS_PATH);
  const relaxedProfiles = relaxedReplay.profiles || {};
  const profileNames = Object.keys(relaxedProfiles);
  const baseAmountSol = Number(relaxedReplay.inputs?.baseTrade?.amountSol || 0.02);
  const bridgeByMint = buildBridgeByMint(bridge);
  const promotionIndex = buildPromotionIndex(promotion);
  const walletEventTouchesByMint = buildWalletEventTouchesByMint(walletEvents, promotionIndex);
  const launchIntelTouchesByMint = buildLaunchIntelTouchesByMint(launchIntelStability);
  const paperConditionalByMint = buildPaperConditionalByMint(paperConditional);
  const decoratedTradesByProfile = {};
  const profileSummaries = {};
  const slices = [];
  for (const profileName of profileNames) {
    const profile = relaxedProfiles[profileName] || {};
    const trades = Array.isArray(profile.trades) ? profile.trades : [];
    const decoratedTrades = trades.map((trade) => decorateTrade(trade, bridgeByMint, walletEventTouchesByMint, launchIntelTouchesByMint, paperConditionalByMint));
    decoratedTradesByProfile[profileName] = decoratedTrades;
    profileSummaries[profileName] = {
      trades: decoratedTrades.length,
      walletEventMintsMatched: uniqueCount(decoratedTrades.filter((trade) => (trade.walletConditioning?.touches || []).some((touch) => touch.source === 'wallet_event_ledger')), (trade) => trade.mint),
      launchIntelShortlistMintsMatched: uniqueCount(decoratedTrades.filter((trade) => (trade.walletConditioning?.touches || []).some((touch) => touch.source === 'launch_intel_stability_shortlist')), (trade) => trade.mint),
      bridgeMintsMatched: uniqueCount(decoratedTrades.filter((trade) => trade.walletConditioning?.bridge), (trade) => trade.mint)
    };
    slices.push(...buildSlices(profileName, decoratedTrades));
  }
  const sliceSummaries = Object.fromEntries(
    slices.map((slice) => {
      const summary = summarizeSlice(slice.name, slice.description, slice.trades, baseAmountSol);
      return [slice.name, { ...summary, profileName: slice.profileName, condition: slice.condition }];
    })
  );
  const ranking = Object.values(sliceSummaries)
    .sort((a, b) => {
      const verdictRank = { PROMISING: 3, INCONCLUSIVE: 2, NEGATIVE: 1, INSUFFICIENT_SAMPLE: 0 };
      return (verdictRank[b.verdict] - verdictRank[a.verdict])
        || Number(b.stressedPnlSol || 0) - Number(a.stressedPnlSol || 0)
        || Number(b.totalPnlSol || 0) - Number(a.totalPnlSol || 0);
    })
    .map(({ name, profileName, condition, verdict, shadowLaneEligible, trades, uniqueMints, wins, losses, winRate, totalPnlSol, averagePnlSol, stressedPnlSol, firstHalfPnlSol, secondHalfPnlSol, top3RemovedPnlSol }) => ({
      name,
      profileName,
      condition,
      verdict,
      shadowLaneEligible,
      trades,
      uniqueMints,
      wins,
      losses,
      winRate,
      totalPnlSol,
      averagePnlSol,
      stressedPnlSol,
      firstHalfPnlSol,
      secondHalfPnlSol,
      top3RemovedPnlSol
    }));

  const avoidNegativeLift = profileNames.map((profileName) => summarizeConditionLift(
    profileName,
    sliceSummaries[`${profileName}__baseline`],
    sliceSummaries[`${profileName}__exclude_avoid_or_negative_touch`]
  )).sort((a, b) => Number(b.stressedDeltaSol || 0) - Number(a.stressedDeltaSol || 0));
  const frozenSlice = slices.find((slice) => slice.name === FROZEN_STABILITY_SLICE);
  const frozenSliceStability = buildFrozenSliceStability(frozenSlice, baseAmountSol);

  const output = {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_conditioned_relaxed_gate_replay',
    note: 'Report-only wallet conditioning over all relaxed-gate replay profiles. Does not alter runtime gates, scoring, sizing, dry-run behavior, or live broadcast state.',
    inputs: {
      profiles: profileNames,
      relaxedReplayPath: path.relative(ROOT, RELAXED_REPLAY_PATH),
      walletFalseNegativeBridgePath: path.relative(ROOT, WALLET_FALSE_NEGATIVE_BRIDGE_PATH),
      walletPaperEntryConditionalPath: path.relative(ROOT, WALLET_PAPER_ENTRY_CONDITIONAL_PATH),
      walletPromotionReviewPath: path.relative(ROOT, WALLET_PROMOTION_REVIEW_PATH),
      walletLaunchIntelStabilityPath: path.relative(ROOT, WALLET_LAUNCH_INTEL_STABILITY_PATH),
      walletEventsPath: path.relative(ROOT, WALLET_EVENTS_PATH),
      totalBaseTrades: Object.values(profileSummaries).reduce((total, item) => total + Number(item.trades || 0), 0),
      baseAmountSol,
      stressExtraSlippagePct: STRESS_EXTRA_SLIPPAGE_PCT,
      bridgeRows: Array.isArray(bridge?.rows) ? bridge.rows.length : 0,
      launchIntelShortlistCandidates: Array.isArray(launchIntelStability?.repeatShortlistCandidates) ? launchIntelStability.repeatShortlistCandidates.length : 0,
      launchIntelShortlistTouchMints: launchIntelTouchesByMint.size,
      walletEvents: walletEvents.length,
      profileSummaries
    },
    criteria: {
      promising: 'n>=60, total pnl > 0, stressed pnl > 0, winRate >= 45%, both split halves positive, and top-3-removed pnl positive.',
      inconclusive: 'Positive but fails at least one PROMISING durability check.',
      negative: 'n>=10 and total pnl <= 0 or stressed pnl <= 0.',
      insufficientSample: 'n<10.'
    },
    summary: {
      sliceCount: Object.keys(sliceSummaries).length,
      promisingSlices: ranking.filter((slice) => slice.verdict === 'PROMISING').length,
      inconclusiveSlices: ranking.filter((slice) => slice.verdict === 'INCONCLUSIVE').length,
      negativeSlices: ranking.filter((slice) => slice.verdict === 'NEGATIVE').length,
      insufficientSampleSlices: ranking.filter((slice) => slice.verdict === 'INSUFFICIENT_SAMPLE').length,
      shadowLaneEligibleSlices: ranking.filter((slice) => slice.shadowLaneEligible).length,
      bestByStressedPnl: ranking[0]?.name || null,
      avoidNegativeImprovedProfiles: avoidNegativeLift.filter((item) => Number(item.stressedDeltaSol || 0) > 0).length,
      avoidNegativeWorsenedProfiles: avoidNegativeLift.filter((item) => Number(item.stressedDeltaSol || 0) < 0).length
    },
    ranking,
    avoidNegativeLift,
    frozenSliceStability: {
      outputPath: path.relative(ROOT, STABILITY_OUTPUT_PATH),
      verdict: frozenSliceStability.stability.verdict,
      checks: frozenSliceStability.stability.checks,
      summary: frozenSliceStability.summary
    },
    slices: sliceSummaries
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  fs.writeFileSync(STABILITY_OUTPUT_PATH, `${JSON.stringify(frozenSliceStability, null, 2)}\n`, 'utf8');
  console.log(`Wrote wallet-conditioned relaxed-gate replay: ${path.relative(ROOT, OUTPUT_PATH)}`);
  console.log(`Wrote wallet-conditioned frozen-slice stability: ${path.relative(ROOT, STABILITY_OUTPUT_PATH)}`);
}

main();
