#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'pre-migration-wallet-channel-health-latest.json');
const PROMOTION_PATH = path.join(ROOT, 'data', 'reports', 'wallet-promotion-review-latest.json');
const MANUAL_KOL_PATH = path.join(ROOT, 'data', 'wallet-watchlists', 'manual-kol-wallets.json');

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

function repoPath(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function readJson(filePath, fallback = {}) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function eventType(event) {
  return event.type || event.event || event.name || 'unknown';
}

function mintOf(payload = {}) {
  return payload.mint || payload.token || payload.mintAddress || payload.address || null;
}

function walletOf(payload = {}) {
  return payload.wallet || payload.traderPublicKey || payload.account || null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function compact(value, digits = 6) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : null;
}

function countBy(rows, keyFn) {
  const counts = {};
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

function topRows(rows, sorter, limit = 12) {
  return rows.slice().sort(sorter).slice(0, limit);
}

function walletSetFromManualKol(parsed = {}) {
  const rows = Array.isArray(parsed) ? parsed : (parsed.wallets || parsed.trackedWallets || []);
  return new Set(rows
    .map((row) => typeof row === 'string' ? row : row?.walletAddress || row?.wallet || row?.address)
    .filter(Boolean));
}

function makePromotionIndex(promotionPath = PROMOTION_PATH, manualPath = MANUAL_KOL_PATH) {
  const promotion = readJson(promotionPath, {});
  const manual = readJson(manualPath, {});
  const manualWallets = walletSetFromManualKol(manual);
  const byAddress = new Map();
  const groups = [
    ['trustReview', promotion.trustReview],
    ['profitableNeedsFirstTouchEvidence', promotion.profitableNeedsFirstTouchEvidence],
    ['watchReview', promotion.watchReview],
    ['avoidReview', promotion.avoidReview],
    ['hold', promotion.hold]
  ];

  for (const [group, rows] of groups) {
    for (const row of Array.isArray(rows) ? rows : []) {
      const wallet = row.walletAddress || row.wallet || row.address || null;
      if (!wallet) continue;
      byAddress.set(wallet, {
        wallet,
        group,
        name: row.name || null,
        reviewTier: row.reviewTier || null,
        evidenceTier: row.evidenceTier || null,
        source: 'promotion_review'
      });
    }
  }

  for (const wallet of manualWallets) {
    if (byAddress.has(wallet)) continue;
    byAddress.set(wallet, {
      wallet,
      group: 'manualKolWallets',
      name: null,
      reviewTier: 'MANUAL_KOL_WATCHLIST',
      evidenceTier: null,
      source: 'manual_kol_watchlist'
    });
  }

  return {
    byAddress,
    groupCounts: {
      ...Object.fromEntries(groups.map(([group, rows]) => [group, Array.isArray(rows) ? rows.length : 0])),
      manualKolWallets: manualWallets.size
    }
  };
}

function isPre85Touch(row = {}) {
  const curve = Number(row.curveProgress);
  return !Number.isFinite(curve)
    || curve < 0.85
    || row.phase === 'fresh_launch'
    || row.phase === 'pre_migration';
}

function isBuy(row = {}) {
  return String(row.side || row.txType || '').toLowerCase() === 'buy';
}

function isPositiveOrProven(row = {}) {
  return ['PROVEN_POSITIVE', 'PROMISING_POSITIVE'].includes(row.evidenceTier)
    || ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE'].includes(row.reviewTier);
}

function isAvoid(row = {}) {
  return row.evidenceTier === 'NEGATIVE_EVIDENCE' || row.reviewTier === 'AVOID_REVIEW';
}

function emptyTouchStats() {
  return {
    touches: 0,
    buys: 0,
    pre85Buys: 0,
    positiveOrProven: 0,
    avoid: 0,
    uniqueWallets: new Set(),
    sampleWallets: []
  };
}

function addTouch(stats, row = {}, meta = null) {
  stats.touches += 1;
  if (isBuy(row)) stats.buys += 1;
  if (isBuy(row) && isPre85Touch(row)) stats.pre85Buys += 1;
  if (isPositiveOrProven(row) || isPositiveOrProven(meta || {})) stats.positiveOrProven += 1;
  if (isAvoid(row) || isAvoid(meta || {})) stats.avoid += 1;
  const wallet = row.wallet || meta?.wallet || null;
  if (wallet) stats.uniqueWallets.add(wallet);
  if (wallet && stats.sampleWallets.length < 5) {
    stats.sampleWallets.push({
      wallet,
      name: row.name || meta?.name || null,
      side: row.side || row.txType || null,
      reviewTier: row.reviewTier || meta?.reviewTier || null,
      evidenceTier: row.evidenceTier || meta?.evidenceTier || null,
      curveProgress: row.curveProgress ?? null,
      tradeAt: row.tradeAt || null
    });
  }
}

function finalizeTouchStats(stats) {
  return {
    touches: stats.touches,
    buys: stats.buys,
    pre85Buys: stats.pre85Buys,
    positiveOrProven: stats.positiveOrProven,
    avoid: stats.avoid,
    uniqueWallets: stats.uniqueWallets.size,
    sampleWallets: stats.sampleWallets
  };
}

function summarizeDecisionWalletChannels(payload = {}, promotionIndex) {
  const context = payload.walletClassificationContext || {};
  const trusted = emptyTouchStats();
  const shadowTrusted = emptyTouchStats();
  const prospective = emptyTouchStats();
  const rawUntrusted = emptyTouchStats();

  for (const row of Array.isArray(context.wallets) ? context.wallets : []) {
    addTouch(trusted, row);
  }
  for (const row of Array.isArray(context.shadowWallets) ? context.shadowWallets : []) {
    addTouch(shadowTrusted, row);
  }
  for (const row of Array.isArray(context.untrustedWallets) ? context.untrustedWallets : []) {
    const meta = promotionIndex.byAddress.get(row.wallet);
    if (meta) addTouch(prospective, row, meta);
    else addTouch(rawUntrusted, row);
  }

  const proof = payload.walletBridgeProof || {};
  return {
    trusted: finalizeTouchStats(trusted),
    shadowTrusted: finalizeTouchStats(shadowTrusted),
    prospective: finalizeTouchStats(prospective),
    rawUntrusted: finalizeTouchStats(rawUntrusted),
    proofFallback: {
      present: Boolean(proof && typeof proof === 'object' && Object.keys(proof).length),
      walletTouchCount: Number(proof.walletTouchCount || 0),
      pre85BuyTouchCount: Number(proof.pre85BuyTouchCount || 0),
      untrustedWalletTouchCount: Number(proof.untrustedWalletTouchCount || 0),
      untrustedPre85BuyTouchCount: Number(proof.untrustedPre85BuyTouchCount || 0)
    }
  };
}

function newMintRow(mint, symbol = null) {
  return {
    mint,
    symbol,
    decisions: 0,
    noTrackedFirstTouchBuyDecisions: 0,
    trustedPre85BuyDecisions: 0,
    prospectivePre85BuyDecisions: 0,
    rawUntrustedPre85BuyDecisions: 0,
    trustedTouches: 0,
    prospectiveTouches: 0,
    rawUntrustedTouches: 0,
    bestScore: null,
    maxCurveProgress: null,
    skipReasons: {},
    prospectiveWallets: {}
  };
}

function updateMintRow(row, payload, channels) {
  row.decisions += 1;
  const reason = payload.reason || payload.skipReason || payload.decision || 'unknown';
  row.skipReasons[reason] = (row.skipReasons[reason] || 0) + 1;
  if (reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') {
    row.noTrackedFirstTouchBuyDecisions += 1;
  }
  row.trustedTouches += channels.trusted.touches;
  row.prospectiveTouches += channels.prospective.touches;
  row.rawUntrustedTouches += channels.rawUntrusted.touches;
  if (channels.trusted.pre85Buys > 0) row.trustedPre85BuyDecisions += 1;
  if (channels.prospective.pre85Buys > 0) row.prospectivePre85BuyDecisions += 1;
  if (channels.rawUntrusted.pre85Buys > 0 || channels.proofFallback.untrustedPre85BuyTouchCount > 0) {
    row.rawUntrustedPre85BuyDecisions += 1;
  }
  const score = Number(payload.score);
  if (Number.isFinite(score)) row.bestScore = row.bestScore === null ? score : Math.max(row.bestScore, score);
  const curve = Number(payload.curveProgress ?? payload.providerCurveProgress ?? payload.paperCurveProgress);
  if (Number.isFinite(curve)) row.maxCurveProgress = row.maxCurveProgress === null ? curve : Math.max(row.maxCurveProgress, curve);
  for (const sample of channels.prospective.sampleWallets) {
    if (!sample.wallet) continue;
    const item = row.prospectiveWallets[sample.wallet] || {
      wallet: sample.wallet,
      name: sample.name,
      reviewTier: sample.reviewTier,
      evidenceTier: sample.evidenceTier,
      touches: 0,
      pre85Buys: 0
    };
    item.touches += 1;
    if (String(sample.side || '').toLowerCase() === 'buy' && (!Number.isFinite(Number(sample.curveProgress)) || Number(sample.curveProgress) < 0.85)) {
      item.pre85Buys += 1;
    }
    row.prospectiveWallets[sample.wallet] = item;
  }
}

async function readTelemetry(filePath, promotionIndex) {
  const provider = {
    trades: 0,
    gateRows: 0,
    recorded: 0,
    untracked: 0,
    noTrader: 0,
    untrustedTapeRecords: 0,
    uniqueTraderWallets: new Set(),
    reasonCounts: {},
    rawTraderFieldKeyCounts: {}
  };
  const decisions = [];
  const rowsByMint = new Map();
  const prospectiveWalletRows = new Map();
  let malformedLines = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      malformedLines += 1;
      continue;
    }
    const type = eventType(event);
    const payload = payloadOf(event);
    if (isRuntimeProviderEvent(type, 'trade')) {
      provider.trades += 1;
    }
    if (type === 'wallet.trade_gate_diagnostic') {
      provider.gateRows += 1;
      const reason = payload.dropReason || 'unknown';
      provider.reasonCounts[reason] = (provider.reasonCounts[reason] || 0) + 1;
      if (reason === 'RECORDED' || payload.ledgerRecord === true) provider.recorded += 1;
      if (reason === 'UNTRACKED_WALLET') provider.untracked += 1;
      if (reason === 'NO_TRADER_FIELD') provider.noTrader += 1;
      if (payload.untrustedTapeRecord === true) provider.untrustedTapeRecords += 1;
      const wallet = walletOf(payload);
      if (wallet) provider.uniqueTraderWallets.add(wallet);
      for (const key of Array.isArray(payload.rawTraderFieldKeys) ? payload.rawTraderFieldKeys : []) {
        provider.rawTraderFieldKeyCounts[key] = (provider.rawTraderFieldKeyCounts[key] || 0) + 1;
      }
      continue;
    }

    if (type !== 'pre_migration_paper.decision') continue;
    const mint = mintOf(payload);
    const atMs = timestampMs(payload.timestamp || event.timestamp);
    if (!mint || !Number.isFinite(atMs)) continue;
    const channels = summarizeDecisionWalletChannels(payload, promotionIndex);
    const reason = payload.reason || payload.skipReason || payload.decision || 'unknown';
    const row = {
      mint,
      symbol: payload.symbol || null,
      atMs,
      at: new Date(atMs).toISOString(),
      reason,
      decision: payload.decision || null,
      score: compact(payload.score, 2),
      curveProgress: compact(payload.curveProgress ?? payload.providerCurveProgress ?? payload.paperCurveProgress, 6),
      channels
    };
    decisions.push(row);
    const mintRow = rowsByMint.get(mint) || newMintRow(mint, payload.symbol || null);
    updateMintRow(mintRow, payload, channels);
    rowsByMint.set(mint, mintRow);

    for (const sample of channels.prospective.sampleWallets) {
      if (!sample.wallet) continue;
      const item = prospectiveWalletRows.get(sample.wallet) || {
        wallet: sample.wallet,
        name: sample.name || null,
        reviewTier: sample.reviewTier || null,
        evidenceTier: sample.evidenceTier || null,
        decisionRows: 0,
        noTrackedFirstTouchBuyRows: 0,
        mints: new Set(),
        pre85BuyRows: 0
      };
      item.decisionRows += 1;
      if (reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY') item.noTrackedFirstTouchBuyRows += 1;
      item.mints.add(mint);
      if (String(sample.side || '').toLowerCase() === 'buy' && (!Number.isFinite(Number(sample.curveProgress)) || Number(sample.curveProgress) < 0.85)) {
        item.pre85BuyRows += 1;
      }
      prospectiveWalletRows.set(sample.wallet, item);
    }
  }

  return {
    provider,
    decisions,
    rowsByMint,
    prospectiveWalletRows,
    malformedLines
  };
}

function finalizeProvider(provider) {
  return {
    providerTradeEvents: provider.trades,
    walletGateDiagnosticRows: provider.gateRows,
    recordedTrustedRows: provider.recorded,
    untrackedRows: provider.untracked,
    noTraderRows: provider.noTrader,
    untrustedTapeRecords: provider.untrustedTapeRecords,
    uniqueTraderWallets: provider.uniqueTraderWallets.size,
    recordedRate: provider.gateRows > 0 ? compact(provider.recorded / provider.gateRows, 6) : null,
    untrackedRate: provider.gateRows > 0 ? compact(provider.untracked / provider.gateRows, 6) : null,
    reasonCounts: provider.reasonCounts,
    rawTraderFieldKeyCounts: provider.rawTraderFieldKeyCounts
  };
}

function buildSummary(telemetry) {
  const rows = telemetry.decisions;
  const noTracked = rows.filter((row) => row.reason === 'CURVE_FALSE_NEGATIVE_BRIDGE_NO_TRACKED_FIRST_TOUCH_BUY');
  const withTrustedTouch = rows.filter((row) => row.channels.trusted.touches > 0);
  const withTrustedPre85 = rows.filter((row) => row.channels.trusted.pre85Buys > 0);
  const withProspective = rows.filter((row) => row.channels.prospective.touches > 0);
  const withProspectivePre85 = rows.filter((row) => row.channels.prospective.pre85Buys > 0);
  const withRawUntrusted = rows.filter((row) => row.channels.rawUntrusted.touches > 0 || row.channels.proofFallback.untrustedWalletTouchCount > 0);
  const withRawUntrustedPre85 = rows.filter((row) => row.channels.rawUntrusted.pre85Buys > 0 || row.channels.proofFallback.untrustedPre85BuyTouchCount > 0);
  const noTrackedProspectivePre85 = noTracked.filter((row) => row.channels.prospective.pre85Buys > 0);
  const noTrackedRawUntrustedPre85 = noTracked.filter((row) => row.channels.rawUntrusted.pre85Buys > 0 || row.channels.proofFallback.untrustedPre85BuyTouchCount > 0);
  return {
    paperDecisionRows: rows.length,
    uniqueDecisionMints: new Set(rows.map((row) => row.mint)).size,
    noTrackedFirstTouchBuyDecisionRows: noTracked.length,
    decisionsWithTrustedTouch: withTrustedTouch.length,
    decisionsWithTrustedPre85Buy: withTrustedPre85.length,
    decisionsWithProspectiveTouch: withProspective.length,
    decisionsWithProspectivePre85Buy: withProspectivePre85.length,
    decisionsWithRawUntrustedTouch: withRawUntrusted.length,
    decisionsWithRawUntrustedPre85Buy: withRawUntrustedPre85.length,
    noTrackedFirstTouchWithProspectivePre85Buy: noTrackedProspectivePre85.length,
    noTrackedFirstTouchWithRawUntrustedPre85Buy: noTrackedRawUntrustedPre85.length,
    projectedNoTrackedCoverageRateIfProspectiveAccepted: noTracked.length > 0
      ? compact(noTrackedProspectivePre85.length / noTracked.length, 6)
      : null,
    channelVerdict: withProspectivePre85.length > 0
      ? 'PROSPECTIVE_CHANNEL_OBSERVED_REPORT_ONLY'
      : (withRawUntrustedPre85.length > 0 ? 'RAW_UNTRUSTED_CHANNEL_ONLY' : 'NO_FLAGGED_WALLET_CHANNEL')
  };
}

function buildReport(filePath, telemetry, promotionIndex) {
  const mintRows = Array.from(telemetry.rowsByMint.values())
    .map((row) => ({
      ...row,
      bestScore: compact(row.bestScore, 2),
      maxCurveProgress: compact(row.maxCurveProgress, 6),
      prospectiveWallets: Object.values(row.prospectiveWallets)
    }));
  const prospectiveWalletRows = Array.from(telemetry.prospectiveWalletRows.values())
    .map((row) => ({
      ...row,
      uniqueMints: row.mints.size,
      mints: undefined
    }));
  return {
    generatedAt: new Date().toISOString(),
    mode: 'report_only_wallet_channel_health',
    sources: {
      telemetryPath: path.relative(ROOT, filePath),
      promotionReviewPath: path.relative(ROOT, PROMOTION_PATH),
      manualKolPath: path.relative(ROOT, MANUAL_KOL_PATH)
    },
    promotionSubstrate: {
      totalProspectiveAddresses: promotionIndex.byAddress.size,
      groupCounts: promotionIndex.groupCounts
    },
    summary: {
      ...buildSummary(telemetry),
      provider: finalizeProvider(telemetry.provider),
      malformedLines: telemetry.malformedLines
    },
    topMintsByProspectivePre85: topRows(
      mintRows.filter((row) => row.prospectivePre85BuyDecisions > 0),
      (a, b) => b.prospectivePre85BuyDecisions - a.prospectivePre85BuyDecisions
        || b.noTrackedFirstTouchBuyDecisions - a.noTrackedFirstTouchBuyDecisions,
      20
    ),
    topMintsByRawUntrustedPre85: topRows(
      mintRows.filter((row) => row.rawUntrustedPre85BuyDecisions > 0),
      (a, b) => b.rawUntrustedPre85BuyDecisions - a.rawUntrustedPre85BuyDecisions
        || b.noTrackedFirstTouchBuyDecisions - a.noTrackedFirstTouchBuyDecisions,
      20
    ),
    topProspectiveWallets: topRows(
      prospectiveWalletRows,
      (a, b) => b.pre85BuyRows - a.pre85BuyRows
        || b.noTrackedFirstTouchBuyRows - a.noTrackedFirstTouchBuyRows
        || b.decisionRows - a.decisionRows,
      20
    ),
    reasonCounts: countBy(telemetry.decisions, (row) => row.reason),
    note: 'Report-only wallet-channel health split for paper decisions. Prospective touches are wallet addresses already present in promotion/manual substrate but observed through untrusted runtime tape; they are not trusted proof and do not affect gates, entries, exits, trust tiers, or live behavior.'
  };
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const telemetryPath = repoPath(args.telemetry) || latestTelemetryFile();
  const outputPath = repoPath(args.output) || OUTPUT_PATH;
  if (!telemetryPath || !fs.existsSync(telemetryPath)) throw new Error('No telemetry file found.');
  const promotionIndex = makePromotionIndex();
  const telemetry = await readTelemetry(telemetryPath, promotionIndex);
  const report = buildReport(telemetryPath, telemetry, promotionIndex);
  writeJson(outputPath, report);
  console.log('Pre-Migration Wallet Channel Health Report');
  console.log(`Telemetry: ${report.sources.telemetryPath}`);
  console.log(`Verdict: ${report.summary.channelVerdict}`);
  console.log(`Decisions/prospectivePre85/rawUntrustedPre85: ${report.summary.paperDecisionRows}/${report.summary.decisionsWithProspectivePre85Buy}/${report.summary.decisionsWithRawUntrustedPre85Buy}`);
  console.log(`Wrote JSON report: ${outputPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildReport,
  summarizeDecisionWalletChannels,
  OUTPUT_PATH
};
