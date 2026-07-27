'use strict';

class HeliusDecisionShadowState {
  constructor(config = {}) {
    this.windowMs = Math.max(10_000, Number(config.pumpMomentumWindowMs || 60_000));
    this.sniperWindowMs = Math.max(1, Number(config.launchIntelSniperWindowMs || 4000));
    // Portal retains 200 prior rows and then appends the current trade.
    this.recentTradeCap = 201;
    this.maxTradeAgeMs = Math.max(this.windowMs * 3, 5 * 60_000);
    this.maxTrackedMints = Math.max(100, Number(config.preMigrationPaperMaxObservedStates || 5000));
    this.maxWalletEvidenceTradesPerMint = 10_000;
    this.mints = new Map();
    this.portalTraderBySignature = new Map();
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
    const existing = this.mints.get(mint) || {
      mint,
      trades: [],
      walletEvidenceTrades: [],
      createdAtMs: null
    };
    if (!Array.isArray(existing.walletEvidenceTrades)) existing.walletEvidenceTrades = [];
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
      const signature = payload.signature || null;
      const eventUser = payload.traderPublicKey || payload.user || null;
      const portalTrader = signature ? this.portalTraderBySignature.get(signature)?.trader || null : null;
      const trade = {
        atMs,
        signature,
        side: side === 'sell' ? 'sell' : 'buy',
        volumeSol: this.finite(payload.solAmount),
        trader: portalTrader || eventUser,
        eventUser,
        identitySource: portalTrader ? 'pumpportal_signature_alias' : 'helius_trade_event_user'
      };
      existing.trades.push(trade);
      if (existing.walletEvidenceTrades.length < this.maxWalletEvidenceTradesPerMint) {
        existing.walletEvidenceTrades.push(trade);
      }
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

  ingestPortalTradeIdentity({ mint = null, signature = null, trader = null, receivedAt = null } = {}) {
    if (!signature || !trader) return false;
    const atMs = this.timestampMs(receivedAt) || Date.now();
    this.portalTraderBySignature.delete(signature);
    this.portalTraderBySignature.set(signature, { mint, trader, atMs });
    while (this.portalTraderBySignature.size > 20_000) {
      this.portalTraderBySignature.delete(this.portalTraderBySignature.keys().next().value);
    }
    const source = mint ? this.mints.get(mint) : null;
    if (source) {
      const trades = new Set([
        ...(source.trades || []),
        ...(source.walletEvidenceTrades || [])
      ]);
      for (const trade of trades) {
        if (trade.signature !== signature) continue;
        trade.trader = trader;
        trade.identitySource = 'pumpportal_signature_alias';
      }
    }
    return true;
  }

  snapshot({ portalToken = {}, portalState = {}, accountState = null, timestamp, resolveWallet = null } = {}) {
    const mint = portalState.mint || portalToken.mint || null;
    const source = mint ? (this.mints.get(mint) || (accountState ? { mint, trades: [] } : null)) : null;
    const atMs = this.timestampMs(timestamp) || Date.now();
    if (!source) {
      return { available: false, reason: 'HELIUS_MINT_STATE_MISSING', state: null, walletContext: null };
    }
    const eligibleTrades = (source.trades || []).filter((row) => row.atMs <= atMs);
    const eligibleWalletTrades = (source.walletEvidenceTrades || source.trades || [])
      .filter((row) => row.atMs <= atMs);
    const recentTrades = eligibleTrades
      .filter((row) => atMs - row.atMs <= this.windowMs)
      .slice(-this.recentTradeCap);
    const recentBuys = recentTrades.filter((row) => row.side === 'buy');
    const recentSells = recentTrades.filter((row) => row.side === 'sell');
    const allBuys = eligibleTrades.filter((row) => row.side === 'buy');
    const allSells = eligibleTrades.filter((row) => row.side === 'sell');
    const recentVolumeSol = recentTrades.reduce((sum, row) => sum + Number(row.volumeSol || 0), 0);
    const totalVolumeSol = eligibleTrades.reduce((sum, row) => sum + Number(row.volumeSol || 0), 0);
    const uniqueBuyers = new Set(recentBuys.map((row) => row.trader).filter(Boolean));
    const uniqueBuyerCountCaptured = recentTrades.length > 0
      && recentBuys.every((row) => Boolean(row.trader));
    const firstReferenceMs = eligibleTrades[0]?.atMs ?? source.createdAtMs ?? null;
    const earlyBuyWindow = Number.isFinite(firstReferenceMs)
      ? allBuys.filter((row) => row.atMs - firstReferenceMs <= this.sniperWindowMs)
      : [];
    const sniperWalletCountCaptured = Number.isFinite(firstReferenceMs)
      && earlyBuyWindow.length > 0
      && earlyBuyWindow.every((row) => Boolean(row.trader));
    const sniperWalletCount = sniperWalletCountCaptured
      ? new Set(earlyBuyWindow.map((row) => row.trader)).size
      : null;
    const walletContext = this.buildWalletContext(eligibleWalletTrades, portalState, resolveWallet);
    const tradeCurveProgress = this.finite(source.curveProgress);
    const tradePriceSol = this.finite(source.priceSol);
    const tradeCurveAtMs = Number.isFinite(source.lastCurveUpdateAtMs) ? source.lastCurveUpdateAtMs : null;
    const accountAtMs = this.timestampMs(accountState?.receivedAtMs ?? accountState?.receivedAt);
    const accountCurveProgress = accountAtMs !== null && accountAtMs <= atMs
      ? this.finite(accountState?.curveProgress)
      : null;
    const accountPriceSol = accountAtMs !== null && accountAtMs <= atMs
      ? this.finite(accountState?.priceSol)
      : null;
    const accountUsable = accountCurveProgress !== null
      && accountPriceSol !== null
      && accountPriceSol > 0
      && (tradeCurveAtMs === null || accountAtMs >= tradeCurveAtMs);
    const curveProgress = accountUsable ? accountCurveProgress : tradeCurveProgress;
    const priceSol = accountUsable ? accountPriceSol : tradePriceSol;
    const curveStateAtMs = accountUsable ? accountAtMs : tradeCurveAtMs;
    const ageMs = Number.isFinite(curveStateAtMs) ? Math.max(0, atMs - curveStateAtMs) : null;
    const tradeStateAgeMs = Number.isFinite(tradeCurveAtMs) ? Math.max(0, atMs - tradeCurveAtMs) : null;
    const accountStateAgeMs = Number.isFinite(accountAtMs) ? Math.max(0, atMs - accountAtMs) : null;
    const curveStateSource = accountUsable
      ? 'finalist_account_verifier'
      : 'helius_pump_trade_event_virtual_token_reserves';
    const lastCurveUpdateAt = Number.isFinite(curveStateAtMs)
      ? new Date(curveStateAtMs).toISOString()
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
      curveProgressSource: curveStateSource,
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
      uniqueBuyerCountCaptured,
      uniqueBuyerRatio: recentBuys.length ? Math.min(uniqueBuyers.size / recentBuys.length, 1) : null,
      sniperWalletCount,
      sniperWalletCountCaptured,
      sniperWalletCountSource: sniperWalletCountCaptured
        ? 'helius_first_reference_buy_window'
        : null,
      sniperWindowAnchoredAtFirstObservation: sniperWalletCountCaptured,
      sniperWindowMs: this.sniperWindowMs,
      bundlerCandidate: false,
      walletClassificationContext: walletContext
    };
    return {
      available: Number.isFinite(curveProgress) && Number.isFinite(priceSol),
      reason: !Number.isFinite(curveProgress)
        ? 'HELIUS_CURVE_MISSING'
        : (!Number.isFinite(priceSol) ? 'HELIUS_PRICE_MISSING' : null),
      ageMs,
      curveStateSource,
      curveStateAt: lastCurveUpdateAt,
      accountEnriched: accountUsable,
      accountStateAgeMs,
      tradeStateAgeMs,
      recentTapeCaptured: recentTrades.length > 0,
      recentTradeCap: this.recentTradeCap,
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
        uniqueBuyerCount: uniqueBuyers.size,
        uniqueBuyerCountCaptured,
        sniperWalletCount,
        sniperWalletCountCaptured,
        sniperWalletCountSource: state.sniperWalletCountSource,
        sniperWindowAnchoredAtFirstObservation:
          state.sniperWindowAnchoredAtFirstObservation,
        sniperWindowMs: this.sniperWindowMs,
        curveStateSource,
        accountEnriched: accountUsable,
        recentTapeCaptured: recentTrades.length > 0,
        recentTradeCap: this.recentTradeCap
      }
    };
  }

  buildWalletContext(trades, state, resolveWallet) {
    const tracked = [];
    const untrusted = [];
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
        shadowOnly: resolved.walletProfile?.shadowOnly === true,
        identitySource: trade.identitySource || 'helius_trade_event_user'
      };
      if (resolved.watched) {
        tracked.push(row);
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
    const retainedTracked = tracked.sort(byTime).slice(0, 50);
    const retainedUntrusted = untrusted.sort(byTime).slice(0, 50);
    const labels = retainedTracked.reduce((counts, row) => {
      counts[row.label] = (counts[row.label] || 0) + 1;
      return counts;
    }, {});
    const retainedNonShadow = retainedTracked.filter((row) => row.shadowOnly !== true);
    const retainedShadow = retainedTracked.filter((row) => row.shadowOnly === true);
    const wallets = retainedNonShadow.slice(0, 8);
    const shadowWallets = retainedShadow.slice(0, 8);
    const untrustedWallets = retainedUntrusted.slice(0, 12);
    const count = (...keys) => keys.reduce((sum, key) => sum + Number(labels[key] || 0), 0);
    const retainedTrades = [...retainedTracked, ...retainedUntrusted];
    return {
      touched: wallets.length > 0,
      shadowTouched: shadowWallets.length > 0,
      untrustedTouched: untrustedWallets.length > 0,
      observedWalletTradeCount: retainedTracked.length,
      observedNonShadowWalletTradeCount: retainedNonShadow.length,
      observedShadowWalletTradeCount: retainedShadow.length,
      observedUntrustedWalletTradeCount: retainedUntrusted.length,
      labelCounts: labels,
      earlySniperCount: count('EARLY_SNIPER'),
      alphaScalperCount: count('EARLY_ALPHA_SCALPER'),
      convictionWhaleCount: count('CONVICTION_WHALE', 'RUNNER_HUNTER', 'DIP_SUPPORT_BUYER'),
      riskWalletCount: count('INSIDER_DUMPER', 'DEV_SIDE_WALLET', 'BUNDLE_CLUSTER', 'LOW_SIGNAL_AVOID'),
      lateChaserCount: count('LATE_CHASER'),
      portalSignatureAliasTradeCount: retainedTrades
        .filter((row) => row.identitySource === 'pumpportal_signature_alias').length,
      heliusEventUserTradeCount: retainedTrades
        .filter((row) => row.identitySource !== 'pumpportal_signature_alias').length,
      walletEvidenceInputTradeCount: trades.length,
      walletEvidenceTradeCapPerMint: this.maxWalletEvidenceTradesPerMint,
      walletEvidenceCapped: trades.length >= this.maxWalletEvidenceTradesPerMint,
      contextSource: 'earliest_50_tracked_and_earliest_50_untrusted_with_signature_aliases',
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
