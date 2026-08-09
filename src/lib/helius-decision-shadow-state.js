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
    // Deliberately no fallback default. launch-intel-store computes bundlerCandidate against
    // config.launchIntelBundlerMinWallets, so inventing a different threshold here would make the
    // counterfactual disagree with the runtime for a reason unrelated to the data source. When the
    // value is absent the shadow reports bundlerCandidateCaptured=false instead of guessing.
    this.bundlerMinWallets = Number(config.launchIntelBundlerMinWallets);
    // Same reasoning as bundlerMinWallets: mirror the runtime's values or report uncaptured.
    this.bundlerWindowMs = Number(config.launchIntelBundlerWindowMs);
    this.maxEarlyBuys = Number(config.launchIntelMaxEarlyBuys);
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
    existing.lastEventAtMs = Number.isFinite(existing.lastEventAtMs)
      ? Math.max(existing.lastEventAtMs, atMs)
      : atMs;
    const connectionEpoch = this.finite(payload.connectionEpoch);
    if (connectionEpoch !== null) existing.lastTransportEpoch = connectionEpoch;
    const transportGapSequence = this.finite(payload.transportGapSequence);
    if (transportGapSequence !== null) existing.lastTransportGapSequence = transportGapSequence;

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
        slot: this.finite(payload.slot),
        connectionEpoch,
        transportGapSequence,
        notificationOutOfOrder: payload.notificationOutOfOrder === true,
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

  snapshot({
    portalToken = {},
    portalState = {},
    accountState = null,
    accountStatus = null,
    transportStatus = null,
    timestamp,
    resolveWallet = null
  } = {}) {
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
    // The runtime lane carries uniqueBuyerCount forward as a monotonic high-water mark over the
    // token's observed life (pre-migration-watch-lane takes Math.max against the stored value),
    // so counting only the rolling windowMs slice is a different metric wearing the same name.
    // On 2026-08-03 that mismatch read 109 against the runtime's 413 and 93 against 218, which
    // dragged shadow score down 3.4 and 6.0 points and flipped two same-path executed entries.
    // walletEvidenceTrades is the cumulative record: capped by count, never pruned by age the
    // way trades is, and still filtered to atMs so the snapshot stays point-in-time correct.
    const cumulativeBuys = eligibleWalletTrades.filter((row) => row.side === 'buy');
    const uniqueBuyers = new Set(cumulativeBuys.map((row) => row.trader).filter(Boolean));
    // Diagnostic only - NOT launch-intel's repeatedEarlyBuyerCount, and not fed to the
    // counterfactual. launch-intel counts first-wave wallets with cross-launch history
    // (getWalletSummary().totalLaunches > 1) capped at 5; this counts wallets that bought THIS
    // mint more than once, uncapped. They are different metrics and measured wildly apart on
    // 2026-08-03 (delta median +13, max +315). Named distinctly so the two are never conflated
    // again. Reproducing the real metric needs a cross-launch wallet index the shadow lacks.
    const buyCountsByTrader = new Map();
    for (const row of cumulativeBuys) {
      if (!row.trader) continue;
      buyCountsByTrader.set(row.trader, (buyCountsByTrader.get(row.trader) || 0) + 1);
    }
    const perMintRepeatBuyerCount = [...buyCountsByTrader.values()]
      .filter((count) => count > 1).length;
    // Same shape as launch-intel-store.updateSummary: bucket buys by slot, count distinct wallets
    // per slot, take the densest slot, and compare against the runtime's own bundlerMinWallets.
    const walletsBySlot = new Map();
    for (const row of cumulativeBuys) {
      if (!row.trader || !Number.isFinite(row.slot)) continue;
      const wallets = walletsBySlot.get(row.slot) || new Set();
      wallets.add(row.trader);
      walletsBySlot.set(row.slot, wallets);
    }
    const densestSlotWalletCount = walletsBySlot.size
      ? Math.max(...[...walletsBySlot.values()].map((wallets) => wallets.size))
      : 0;
    const bundlerCandidateCaptured = Number.isFinite(this.bundlerMinWallets)
      && cumulativeBuys.some((row) => Number.isFinite(row.slot));
    const bundlerCandidate = bundlerCandidateCaptured
      && densestSlotWalletCount >= this.bundlerMinWallets;
    const windowedUniqueBuyers = new Set(recentBuys.map((row) => row.trader).filter(Boolean));
    const uniqueBuyerCountCaptured = cumulativeBuys.length > 0
      && cumulativeBuys.every((row) => Boolean(row.trader));
    const controlledAnchorMs = this.finite(
      portalState.sniperWindowAnchorAtMs ?? portalToken.sniperWindowAnchorAtMs
    );
    const controlledAnchorKind = portalState.sniperWindowAnchorKind
      || portalToken.sniperWindowAnchorKind
      || null;
    const controlledWindowMs = this.finite(
      portalState.sniperWindowMs ?? portalToken.sniperWindowMs
    );
    const sniperWindowAnchorControlApplied = controlledAnchorMs !== null
      && controlledAnchorKind === 'first_trade'
      && controlledWindowMs !== null
      && controlledWindowMs > 0;
    const firstReferenceMs = sniperWindowAnchorControlApplied
      ? controlledAnchorMs
      : (eligibleTrades[0]?.atMs ?? source.createdAtMs ?? null);
    const sniperWindowAnchorKind = sniperWindowAnchorControlApplied
      ? controlledAnchorKind
      : (eligibleTrades.length > 0
        ? 'first_referenced_trade'
        : (Number.isFinite(source.createdAtMs) ? 'created_at' : null));
    const sniperWindowMs = sniperWindowAnchorControlApplied
      ? controlledWindowMs
      : this.sniperWindowMs;
    const earlyBuyWindow = Number.isFinite(firstReferenceMs)
      ? allBuys.filter((row) => (
        row.atMs >= firstReferenceMs
        && row.atMs - firstReferenceMs <= sniperWindowMs
      ))
      : [];
    const sniperWalletCountCaptured = Number.isFinite(firstReferenceMs)
      && earlyBuyWindow.length > 0
      && earlyBuyWindow.every((row) => Boolean(row.trader));
    const sniperWalletCount = sniperWalletCountCaptured
      ? new Set(earlyBuyWindow.map((row) => row.trader)).size
      : null;
    // First-wave wallets for kolOverlap. launch-intel-store derives firstWaveDistinctWallets from
    // record.earlyBuys (the first maxEarlyBuys buys chronologically) filtered to bundlerWindowMs
    // from the first reference, so the cap is applied before the window to match. The KOL lookup
    // itself stays in the engine because kolWalletProfiles is reference data loaded from
    // wallet-intel/kolscan/manual files - it is not derived from either provider's tape.
    const firstWaveCaptured = Number.isFinite(firstReferenceMs)
      && Number.isFinite(this.bundlerWindowMs);
    const cappedEarlyBuys = Number.isFinite(this.maxEarlyBuys)
      ? cumulativeBuys.slice(0, this.maxEarlyBuys)
      : cumulativeBuys;
    const firstWaveWallets = firstWaveCaptured
      ? [...new Set(cappedEarlyBuys
        .filter((row) => (
          row.atMs >= firstReferenceMs
          && row.atMs - firstReferenceMs <= this.bundlerWindowMs
        ))
        .map((row) => row.trader)
        .filter(Boolean))]
      : [];
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
    const rawTransportEpoch = this.finite(transportStatus?.connectionEpoch);
    const rawStateTransportEpoch = this.finite(source.lastTransportEpoch);
    const lastRecoveredGapAtMs = this.finite(transportStatus?.lastRecoveredGapAtMs);
    const rawTransportRecoveryWindowActive = lastRecoveredGapAtMs !== null
      && atMs >= lastRecoveredGapAtMs
      && atMs - lastRecoveredGapAtMs <= this.windowMs;
    const rawTransportGapAffected = rawTransportEpoch !== null && (
      transportStatus?.connected !== true
      || transportStatus?.subscriptionReady !== true
      || transportStatus?.transportGapActive === true
      || rawStateTransportEpoch === null
      || rawStateTransportEpoch !== rawTransportEpoch
      || rawTransportRecoveryWindowActive
    );
    const accountTransportGapAffected = accountStatus?.transportGapAffected === true;
    const accountUsable = accountCurveProgress !== null
      && accountPriceSol !== null
      && accountPriceSol > 0
      && !accountTransportGapAffected
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
      // Retains the pre-2026-08-03 rolling-window value as a named diagnostic so the
      // cumulative/windowed gap stays measurable instead of disappearing into the fix.
      windowedUniqueBuyerCount: windowedUniqueBuyers.size,
      uniqueBuyerRatio: recentBuys.length
        ? Math.min(windowedUniqueBuyers.size / recentBuys.length, 1)
        : null,
      sniperWalletCount,
      sniperWalletCountCaptured,
      sniperWalletCountSource: sniperWalletCountCaptured
        ? (sniperWindowAnchorControlApplied
          ? 'helius_actual_first_trade_anchored_buy_window'
          : 'helius_first_reference_buy_window')
        : null,
      sniperWindowAnchoredAtFirstObservation: Number.isFinite(firstReferenceMs),
      sniperWindowAnchorAtMs: Number.isFinite(firstReferenceMs) ? firstReferenceMs : null,
      sniperWindowAnchorKind,
      sniperWindowMs,
      sniperWindowAnchorControlApplied,
      sniperWindowAnchorControlSource: sniperWindowAnchorControlApplied
        ? 'pumpportal_actual_lane_sniper_window'
        : null,
      perMintRepeatBuyerCount,
      // Diagnostic only. Not fed to the counterfactual: PumpPortal payloads carry no slot, so the
      // runtime's slotBuyCounts never populates and its bundlerCandidate is always false. Scoring
      // the shadow on a feature the oracle cannot compute breaks like-for-like comparison.
      bundlerCandidate,
      bundlerCandidateCaptured,
      densestSlotWalletCount,
      firstWaveWallets,
      firstWaveCaptured,
      walletClassificationContext: walletContext,
      rawTransportEpoch,
      rawStateTransportEpoch,
      rawTransportGapAffected,
      accountTransportGapAffected
    };
    const stateAvailable = Number.isFinite(curveProgress)
      && Number.isFinite(priceSol)
      && !rawTransportGapAffected;
    return {
      available: stateAvailable,
      reason: rawTransportGapAffected
        ? 'HELIUS_SHADOW_TRANSPORT_GAP'
        : (!Number.isFinite(curveProgress)
          ? 'HELIUS_CURVE_MISSING'
          : (!Number.isFinite(priceSol) ? 'HELIUS_PRICE_MISSING' : null)),
      ageMs,
      curveStateSource,
      curveStateAt: lastCurveUpdateAt,
      accountEnriched: accountUsable,
      accountStateAgeMs,
      tradeStateAgeMs,
      rawTransportEpoch,
      rawStateTransportEpoch,
      rawTransportConnected: transportStatus?.connected ?? null,
      rawTransportSubscriptionReady: transportStatus?.subscriptionReady ?? null,
      rawTransportGapActive: transportStatus?.transportGapActive === true,
      rawTransportGapSequence: transportStatus?.transportGapSequence ?? null,
      rawTransportGapAffected,
      rawTransportRecoveryWindowActive,
      lastRecoveredGapAtMs,
      lastRecoveredGapDurationMs: this.finite(transportStatus?.lastRecoveredGapDurationMs),
      accountTransportInspectable: accountStatus?.accountTransportInspectable ?? null,
      accountTransportConnected: accountStatus?.accountTransportConnected ?? null,
      accountTransportGeneration: accountStatus?.accountTransportGeneration ?? null,
      accountLatestUpdateTransportGeneration:
        accountStatus?.latestUpdateTransportGeneration ?? null,
      accountTransportGapAffected,
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
        sniperWindowAnchorAtMs: state.sniperWindowAnchorAtMs,
        sniperWindowAnchorKind: state.sniperWindowAnchorKind,
        sniperWindowMs,
        curveStateSource,
        accountEnriched: accountUsable,
        rawTransportEpoch,
        rawStateTransportEpoch,
        rawTransportGapAffected,
        accountTransportGapAffected,
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
