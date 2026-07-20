'use strict';

class HeliusDecisionShadowState {
  constructor(config = {}) {
    this.windowMs = Math.max(10_000, Number(config.pumpMomentumWindowMs || 60_000));
    this.maxTradeAgeMs = Math.max(this.windowMs * 3, 5 * 60_000);
    this.maxTrackedMints = Math.max(100, Number(config.preMigrationPaperMaxObservedStates || 5000));
    this.mints = new Map();
  }

  ingest(type, payload = {}, receivedAt = null) {
    if (!String(type || '').startsWith('provider.helius_pumpfun.shadow_')) return false;
    if (
      type.endsWith('shadow_trade')
      && String(payload.pairBase || '').toUpperCase() !== 'SOL'
    ) return false;
    const mint = payload.mint || null;
    if (!mint) return false;
    const atMs = this.timestampMs(payload.receivedAt || receivedAt || payload.eventAt || payload.timestamp) || Date.now();
    const existing = this.mints.get(mint) || { mint, trades: [], createdAtMs: null };
    existing.symbol = payload.symbol || existing.symbol || null;
    existing.name = payload.name || existing.name || null;
    existing.quoteMint = payload.quoteMint || existing.quoteMint || null;
    existing.pairBase = payload.pairBase || existing.pairBase || null;
    existing.lastEventAtMs = atMs;

    if (type.endsWith('shadow_new_token')) {
      existing.createdAtMs = this.timestampMs(payload.eventAt) || atMs;
      existing.bondingCurveAddress = payload.bondingCurve || existing.bondingCurveAddress || null;
    } else if (type.endsWith('shadow_trade')) {
      const side = String(payload.txType || '').toLowerCase();
      existing.trades.push({
        atMs,
        signature: payload.signature || null,
        side: side === 'sell' ? 'sell' : 'buy',
        volumeSol: this.finite(payload.solAmount),
        trader: payload.traderPublicKey || payload.user || null
      });
      existing.trades = existing.trades.filter((row) => atMs - row.atMs <= this.maxTradeAgeMs).slice(-2000);
    } else if (type.endsWith('shadow_complete') || type.endsWith('shadow_migration')) {
      existing.complete = true;
      existing.migratedAt = atMs;
    }

    const curveProgress = this.finite(payload.providerCurveProgress ?? payload.curveProgress);
    if (curveProgress !== null) existing.curveProgress = Math.max(0, Math.min(curveProgress, 1));
    const priceSol = this.finite(payload.priceSol);
    if (priceSol !== null && priceSol > 0) existing.priceSol = priceSol;
    const virtualSolReservesSol = this.finite(payload.virtualQuoteReservesUi ?? payload.virtualSolReservesSol);
    if (virtualSolReservesSol !== null) existing.virtualSolReservesSol = virtualSolReservesSol;
    const virtualTokenReservesTokens = this.finite(payload.virtualTokenReservesTokens);
    if (virtualTokenReservesTokens !== null) existing.virtualTokenReservesTokens = virtualTokenReservesTokens;
    existing.lastCurveUpdateAtMs = curveProgress !== null ? atMs : existing.lastCurveUpdateAtMs || null;
    this.mints.delete(mint);
    this.mints.set(mint, existing);
    while (this.mints.size > this.maxTrackedMints) this.mints.delete(this.mints.keys().next().value);
    return true;
  }

  snapshot({ portalToken = {}, portalState = {}, timestamp, resolveWallet = null } = {}) {
    const mint = portalState.mint || portalToken.mint || null;
    const source = mint ? this.mints.get(mint) : null;
    const atMs = this.timestampMs(timestamp) || Date.now();
    if (!source || !Number.isFinite(source.lastEventAtMs)) {
      return { available: false, reason: 'HELIUS_MINT_STATE_MISSING', state: null, walletContext: null };
    }
    const eligibleTrades = source.trades.filter((row) => row.atMs <= atMs);
    const recentTrades = eligibleTrades.filter((row) => atMs - row.atMs <= this.windowMs);
    const recentBuys = recentTrades.filter((row) => row.side === 'buy');
    const recentSells = recentTrades.filter((row) => row.side === 'sell');
    const allBuys = eligibleTrades.filter((row) => row.side === 'buy');
    const allSells = eligibleTrades.filter((row) => row.side === 'sell');
    const recentVolumeSol = recentTrades.reduce((sum, row) => sum + Number(row.volumeSol || 0), 0);
    const totalVolumeSol = eligibleTrades.reduce((sum, row) => sum + Number(row.volumeSol || 0), 0);
    const uniqueBuyers = new Set(recentBuys.map((row) => row.trader).filter(Boolean));
    const walletContext = this.buildWalletContext(eligibleTrades.slice(-50), portalState, resolveWallet);
    const curveProgress = this.finite(source.curveProgress);
    const priceSol = this.finite(source.priceSol);
    const ageMs = Math.max(0, atMs - source.lastEventAtMs);
    const lastCurveUpdateAt = Number.isFinite(source.lastCurveUpdateAtMs)
      ? new Date(source.lastCurveUpdateAtMs).toISOString()
      : null;
    const state = {
      ...portalToken,
      ...portalState,
      mint,
      symbol: portalState.symbol || portalToken.symbol || source.symbol || null,
      name: portalToken.name || source.name || null,
      createdAt: portalToken.createdAt || source.createdAtMs || null,
      source: 'helius_pumpfun_decision_shadow',
      quoteMint: source.quoteMint || portalState.quoteMint || portalToken.quoteMint || null,
      pairBase: source.pairBase || portalState.pairBase || portalToken.pairBase || null,
      curveProgress,
      bondingCurveProgress: curveProgress,
      providerCurveProgress: curveProgress,
      providerCurveSnapshotAt: lastCurveUpdateAt,
      lastCurveUpdateAt,
      curveProgressSource: 'helius_pump_trade_event_virtual_token_reserves',
      bondingCurvePriceSol: priceSol,
      providerCurvePriceSol: priceSol,
      priceSol,
      virtualSolReservesSol: source.virtualSolReservesSol ?? portalState.virtualSolReservesSol ?? null,
      virtualTokenReservesTokens: source.virtualTokenReservesTokens ?? portalState.virtualTokenReservesTokens ?? null,
      bondingStage: source.complete || curveProgress >= 1
        ? 'recently_bonded'
        : (curveProgress >= 0.9 ? 'almost_bonded' : 'bonding_curve'),
      migratedAt: source.migratedAt ? new Date(source.migratedAt).toISOString() : null,
      firstTradeAt: eligibleTrades.length ? eligibleTrades[0].atMs : null,
      tradeCount: eligibleTrades.length,
      buys: allBuys.length,
      sells: allSells.length,
      volumeSol: totalVolumeSol,
      recentBuys: recentBuys.length,
      recentSells: recentSells.length,
      recentTradeCount: recentTrades.length,
      recentVolumeSol,
      tradeVelocityPerMin: recentTrades.length / Math.max(this.windowMs / 60_000, 0.001),
      buyRatio: recentTrades.length ? recentBuys.length / recentTrades.length : 0.5,
      buyRatioCaptured: recentTrades.length > 0,
      uniqueBuyerCount: uniqueBuyers.size,
      uniqueBuyerCountCaptured: recentTrades.length > 0,
      uniqueBuyerRatio: recentBuys.length ? Math.min(uniqueBuyers.size / recentBuys.length, 1) : null,
      sniperWalletCount: 0,
      sniperWalletCountCaptured: false,
      bundlerCandidate: false,
      walletClassificationContext: walletContext
    };
    return {
      available: Number.isFinite(curveProgress) && Number.isFinite(priceSol) && recentTrades.length > 0,
      reason: !Number.isFinite(curveProgress)
        ? 'HELIUS_CURVE_MISSING'
        : (!Number.isFinite(priceSol) ? 'HELIUS_PRICE_MISSING' : (recentTrades.length ? null : 'HELIUS_RECENT_TAPE_EMPTY')),
      ageMs,
      state,
      walletContext,
      market: {
        curveProgress,
        priceSol,
        recentBuys: recentBuys.length,
        recentSells: recentSells.length,
        recentTradeCount: recentTrades.length,
        recentVolumeSol,
        tradeVelocityPerMin: state.tradeVelocityPerMin,
        uniqueBuyerCount: uniqueBuyers.size
      }
    };
  }

  buildWalletContext(trades, state, resolveWallet) {
    const watched = [];
    const shadow = [];
    const untrusted = [];
    const labels = {};
    for (const trade of trades) {
      if (!trade.trader) continue;
      const resolved = typeof resolveWallet === 'function' ? resolveWallet(trade.trader) || {} : {};
      const row = {
        wallet: trade.trader,
        name: resolved.walletProfile?.name || resolved.promotion?.name || null,
        walletProfile: resolved.walletProfile?.profile || null,
        walletSource: resolved.walletProfile?.source || null,
        walletFlags: Array.isArray(resolved.walletProfile?.flags) ? resolved.walletProfile.flags.slice(0, 12) : [],
        walletCohort: resolved.walletProfile?.shadowOnly === true
          ? (resolved.walletProfile?.profile || 'shadow_wallet_profile')
          : (resolved.walletProfile?.profile || 'manual_kol_v1'),
        label: resolved.classification?.label || 'UNCLASSIFIED',
        confidence: resolved.classification?.confidence ?? null,
        side: trade.side,
        phase: Number(state.curveProgress || 0) >= 0.85 ? 'late_pre_migration' : 'pre_migration',
        tradeAt: new Date(trade.atMs).toISOString(),
        reviewTier: resolved.promotion?.reviewTier || null,
        evidenceTier: resolved.promotion?.evidenceTier || null,
        solAmount: trade.volumeSol,
        curveProgress: state.curveProgress ?? null,
        shadowOnly: resolved.walletProfile?.shadowOnly === true
      };
      if (resolved.watched) {
        labels[row.label] = (labels[row.label] || 0) + 1;
        (row.shadowOnly ? shadow : watched).push(row);
      } else {
        untrusted.push({
          ...row,
          label: 'UNTRUSTED_RUNTIME_TAPE',
          trustedSignal: false,
          untrustedRuntimeTape: true,
          untrustedReason: 'UNTRACKED_HELIUS_EVENT_USER'
        });
      }
    }
    const byTime = (left, right) => Date.parse(left.tradeAt) - Date.parse(right.tradeAt);
    const wallets = watched.sort(byTime).slice(0, 8);
    const shadowWallets = shadow.sort(byTime).slice(0, 8);
    const untrustedWallets = untrusted.sort(byTime).slice(0, 12);
    const count = (...keys) => keys.reduce((sum, key) => sum + Number(labels[key] || 0), 0);
    return {
      touched: wallets.length > 0,
      shadowTouched: shadowWallets.length > 0,
      untrustedTouched: untrustedWallets.length > 0,
      observedWalletTradeCount: wallets.length + shadowWallets.length,
      observedNonShadowWalletTradeCount: wallets.length,
      observedShadowWalletTradeCount: shadowWallets.length,
      observedUntrustedWalletTradeCount: untrustedWallets.length,
      labelCounts: labels,
      earlySniperCount: count('EARLY_SNIPER'),
      alphaScalperCount: count('EARLY_ALPHA_SCALPER'),
      convictionWhaleCount: count('CONVICTION_WHALE', 'RUNNER_HUNTER', 'DIP_SUPPORT_BUYER'),
      riskWalletCount: count('INSIDER_DUMPER', 'DEV_SIDE_WALLET', 'BUNDLE_CLUSTER', 'LOW_SIGNAL_AVOID'),
      lateChaserCount: count('LATE_CHASER'),
      contextSource: 'helius_event_user_shadow',
      earliestTouchAt: wallets[0]?.tradeAt || null,
      earliestBuyAt: wallets.find((row) => row.side === 'buy')?.tradeAt || null,
      wallets,
      shadowWallets,
      earliestShadowTouchAt: shadowWallets[0]?.tradeAt || null,
      earliestShadowBuyAt: shadowWallets.find((row) => row.side === 'buy')?.tradeAt || null,
      earliestUntrustedTouchAt: untrustedWallets[0]?.tradeAt || null,
      earliestUntrustedBuyAt: untrustedWallets.find((row) => row.side === 'buy')?.tradeAt || null,
      untrustedWallets
    };
  }

  timestampMs(value) {
    if (Number.isFinite(Number(value))) {
      const numeric = Number(value);
      return numeric > 1e12 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
  }

  finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
}

module.exports = HeliusDecisionShadowState;
