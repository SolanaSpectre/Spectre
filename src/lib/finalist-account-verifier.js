const { PublicKey } = require('@solana/web3.js');

const SENTINEL_BONDING_CURVE_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);

function normalizedTriggerReasons(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values
    .filter((item) => typeof item === 'string' && item.length > 0)
    .map((item) => item.slice(0, 64)))]
    .slice(0, 12);
}

function prewarmToComparisonPath(subscription) {
  if (!subscription) return null;
  const hasTimestamp = (value) => value !== null
    && value !== undefined
    && value !== ''
    && Number.isFinite(Number(value));
  const prewarmed = hasTimestamp(subscription.prewarmRequestedAt);
  const comparisonRequested = hasTimestamp(subscription.comparisonRequestedAt);
  if (prewarmed && comparisonRequested) return 'PREWARM_THEN_COMPARISON';
  if (prewarmed) return 'PREWARM_ONLY';
  if (comparisonRequested) return 'DIRECT_COMPARISON_SUBSCRIPTION';
  return 'NON_DECISION_SHADOW_SUBSCRIPTION';
}

class FinalistAccountVerifier {
  constructor(config, logger, options = {}) {
    this.config = config;
    this.logger = logger;
    this.connection = options.connection || null;
    this.accountReader = options.accountReader || null;
    this.decodeBondingCurveAccount = options.decodeBondingCurveAccount || null;
    this.deriveBondingCurveAddress = typeof options.deriveBondingCurveAddress === 'function'
      ? options.deriveBondingCurveAddress
      : null;
    this.programId = new PublicKey(config.pumpBondingCurveProgramId);
    this.telemetryHook = typeof options.telemetryHook === 'function' ? options.telemetryHook : null;
    this.enabled = config.finalistAccountVerifierEnabled !== false;
    this.commitment = config.finalistAccountVerifierCommitment || 'processed';
    this.maxSubscriptions = Math.max(1, Number(config.finalistAccountVerifierMaxSubscriptions || 12));
    this.ttlMs = Math.max(1000, Number(config.finalistAccountVerifierTtlMs || 120000));
    this.freshMs = Math.max(100, Number(config.finalistAccountVerifierFreshMs || 1500));
    this.initialSnapshotEnabled = config.finalistAccountVerifierInitialSnapshotEnabled !== false;
    this.initialSnapshotMethod = String(config.finalistAccountVerifierInitialSnapshotMethod || 'getMultipleAccountsInfo').toLowerCase() === 'getaccountinfo'
      ? 'getAccountInfo'
      : 'getMultipleAccountsInfo';
    this.maxCurveDelta = Math.max(0, Number(config.finalistAccountVerifierMaxCurveDelta ?? 0.05));
    this.updateTelemetryMinIntervalMs = Math.max(100, Number(config.finalistAccountVerifierUpdateTelemetryMinIntervalMs || 1000));
    this.updateTelemetryMinCurveDelta = Math.max(0, Number(config.finalistAccountVerifierUpdateTelemetryMinCurveDelta || 0.001));
    this.subscriptions = new Map();
    this.stats = {
      enabled: this.enabled,
      attempts: 0,
      subscribed: 0,
      duplicateRequests: 0,
      maxSkipped: 0,
      invalidSkipped: 0,
      subscribeErrors: 0,
      updates: 0,
      freshUpdates: 0,
      decodeErrors: 0,
      ownerMismatches: 0,
      initialSnapshots: 0,
      initialSnapshotMissing: 0,
      initialSnapshotErrors: 0,
      decisionShadowPrewarmAttempts: 0,
      decisionShadowPrewarmSubscribed: 0,
      decisionShadowPrewarmDuplicateRequests: 0,
      decisionShadowPrewarmCapacitySkips: 0,
      decisionShadowCandidateUpgrades: 0,
      decisionShadowPriorityEvictions: 0,
      shadowGateChecks: 0,
      shadowGateReady: 0,
      shadowGateBlocked: 0,
      expired: 0,
      unsubscribed: 0,
      active: 0,
      maxSubscriptions: this.maxSubscriptions,
      ttlMs: this.ttlMs,
      freshMs: this.freshMs,
      initialSnapshotEnabled: this.initialSnapshotEnabled,
      initialSnapshotMethod: this.initialSnapshotMethod,
      maxCurveDelta: this.maxCurveDelta,
      commitment: this.commitment,
      updateTelemetrySuppressed: 0,
      updateTelemetryMinIntervalMs: this.updateTelemetryMinIntervalMs,
      updateTelemetryMinCurveDelta: this.updateTelemetryMinCurveDelta
    };
  }

  emit(type, payload = {}) {
    if (!this.telemetryHook) return;
    try {
      this.telemetryHook(type, payload);
    } catch {
      // Report-only telemetry must never affect trading behavior.
    }
  }

  qualifies(state = {}) {
    const score = Number(state.score);
    const curve = Number(state.curveProgress);
    const confirmed = state.confirmed === true;
    const flagged = state.flagged === true;
    const sniperWalletCount = Number(state.sniperWalletCount || state.riskWalletCount || 0);
    const repeatedEarlyBuyerCount = Number(state.repeatedEarlyBuyerCount || 0);
    if (!flagged && !confirmed) return false;
    if (confirmed && (score >= this.config.finalistAccountVerifierMinConfirmedScore || curve >= this.config.finalistAccountVerifierMinConfirmedCurveProgress)) {
      return 'confirmed_finalist';
    }
    if (score >= this.config.finalistAccountVerifierMinScore || curve >= this.config.finalistAccountVerifierMinCurveProgress) {
      return 'flagged_finalist';
    }
    if (score >= this.config.finalistAccountVerifierMinWalletScore && (sniperWalletCount > 0 || repeatedEarlyBuyerCount > 0)) {
      return 'wallet_supported_finalist';
    }
    return false;
  }

  async maybeSubscribe(state = {}, meta = {}) {
    if (!this.enabled || !this.connection || typeof this.connection.onAccountChange !== 'function') {
      return false;
    }

    const decisionShadowCandidate = meta.reportOnlyDecisionShadowCandidate === true;
    const decisionShadowPrewarm = meta.reportOnlyDecisionShadowPrewarm === true;
    const rawPrewarmTriggerReasons = Array.isArray(meta.decisionShadowPrewarmTriggerReasons)
      && meta.decisionShadowPrewarmTriggerReasons.length > 0
      ? meta.decisionShadowPrewarmTriggerReasons
      : meta.decisionShadowPrewarmTriggerReason;
    const prewarmTriggerReasons = decisionShadowPrewarm
      ? normalizedTriggerReasons(rawPrewarmTriggerReasons)
      : [];
    const prewarmTriggerReason = prewarmTriggerReasons[0] || null;
    const comparisonTrigger = decisionShadowCandidate
      ? String(meta.source || 'helius_decision_shadow_comparison').slice(0, 64)
      : null;
    const selectionClass = decisionShadowCandidate
      ? 'decision_shadow_candidate'
      : decisionShadowPrewarm
        ? 'decision_shadow_prewarm'
        : this.qualifies({
        ...state,
        flagged: meta.flagged ?? state.flagged,
        confirmed: meta.confirmed ?? state.confirmed
      });
    if (!selectionClass) return false;

    this.pruneExpired('before_subscribe');
    this.stats.attempts += 1;
    if (decisionShadowPrewarm) this.stats.decisionShadowPrewarmAttempts += 1;

    const mint = state.mint || state.token || state.mintAddress;
    const providerBondingCurveAddress = state.bondingCurveAddress || state.bondingCurveKey || null;
    const derivedBondingCurveAddress = this.deriveBondingCurveAddress && mint
      ? this.deriveBondingCurveAddress(mint)
      : null;
    const bondingCurveAddress = derivedBondingCurveAddress || providerBondingCurveAddress;
    if (!mint || !bondingCurveAddress) {
      this.stats.invalidSkipped += 1;
      this.emit('finalist_account_verifier.skipped', {
        mint: mint || null,
        providerBondingCurveAddress,
        reason: !mint ? 'MISSING_MINT' : 'MISSING_BONDING_CURVE_ADDRESS',
        selectionClass
      });
      return false;
    }

    if (SENTINEL_BONDING_CURVE_ADDRESSES.has(String(bondingCurveAddress))) {
      this.stats.invalidSkipped += 1;
      this.emit('finalist_account_verifier.skipped', {
        mint,
        bondingCurveAddress,
        providerBondingCurveAddress,
        derivedBondingCurveAddress,
        reason: 'SENTINEL_BONDING_CURVE_ADDRESS',
        selectionClass
      });
      return false;
    }

    if (this.subscriptions.has(mint)) {
      this.stats.duplicateRequests += 1;
      const existing = this.subscriptions.get(mint);
      const requestedAt = Date.now();
      if (decisionShadowCandidate) {
        existing.lastRequestedAt = requestedAt;
        existing.comparisonRequestedAt = existing.comparisonRequestedAt || requestedAt;
        existing.comparisonTrigger = existing.comparisonTrigger || comparisonTrigger;
        if (existing.selectionClass === 'decision_shadow_prewarm') {
          existing.selectionClass = 'decision_shadow_candidate';
          existing.selectionPriority = 2;
          this.stats.decisionShadowCandidateUpgrades += 1;
        }
        existing.expiresAt = Math.max(existing.expiresAt, requestedAt + this.ttlMs);
      } else if (decisionShadowPrewarm) {
        this.stats.decisionShadowPrewarmDuplicateRequests += 1;
        existing.prewarmDuplicateRequests = Number(existing.prewarmDuplicateRequests || 0) + 1;
        existing.prewarmTriggerReasonsSeen = [...new Set([
          ...(existing.prewarmTriggerReasonsSeen || []),
          ...prewarmTriggerReasons
        ])];
      } else {
        existing.expiresAt = Math.max(existing.expiresAt, requestedAt + this.ttlMs);
      }
      return true;
    }

    if (this.subscriptions.size >= this.maxSubscriptions) {
      if (decisionShadowCandidate) {
        const evictable = Array.from(this.subscriptions.values())
          .filter((subscription) => subscription.selectionClass === 'decision_shadow_prewarm')
          .sort((left, right) => Number(left.prewarmRequestedAt || left.subscribedAt || 0)
            - Number(right.prewarmRequestedAt || right.subscribedAt || 0))[0];
        if (evictable) {
          this.unsubscribeMint(evictable.mint, 'PRIORITY_EVICTION_FOR_DECISION_SHADOW_CANDIDATE');
          this.stats.decisionShadowPriorityEvictions += 1;
        }
      }
    }

    if (this.subscriptions.size >= this.maxSubscriptions) {
      this.stats.maxSkipped += 1;
      if (decisionShadowPrewarm) this.stats.decisionShadowPrewarmCapacitySkips += 1;
      this.emit('finalist_account_verifier.skipped', {
        mint,
        bondingCurveAddress,
        providerBondingCurveAddress,
        derivedBondingCurveAddress,
        reason: decisionShadowPrewarm ? 'MAX_SUBSCRIPTIONS_PREWARM' : 'MAX_SUBSCRIPTIONS',
        selectionClass,
        prewarmTriggerReason,
        prewarmTriggerReasons,
        active: this.subscriptions.size,
        maxSubscriptions: this.maxSubscriptions
      });
      return false;
    }

    let publicKey;
    try {
      publicKey = new PublicKey(bondingCurveAddress);
    } catch (error) {
      this.stats.invalidSkipped += 1;
      this.emit('finalist_account_verifier.skipped', {
        mint,
        bondingCurveAddress,
        providerBondingCurveAddress,
        derivedBondingCurveAddress,
        reason: 'INVALID_BONDING_CURVE_ADDRESS',
        errorMessage: error.message,
        selectionClass
      });
      return false;
    }

    try {
      const subscribedAt = Date.now();
      const subscriptionId = this.connection.onAccountChange(
        publicKey,
        (accountInfo, context) => this.handleAccountUpdate(mint, bondingCurveAddress, accountInfo, context),
        this.commitment
      );
      this.subscriptions.set(mint, {
        mint,
        symbol: state.symbol || null,
        bondingCurveAddress,
        providerBondingCurveAddress,
        derivedBondingCurveAddress,
        selectionClass,
        selectionPriority: decisionShadowCandidate ? 2 : decisionShadowPrewarm ? 1 : 0,
        prewarmRequestedAt: decisionShadowPrewarm ? subscribedAt : null,
        comparisonRequestedAt: decisionShadowCandidate ? subscribedAt : null,
        prewarmTriggerReason,
        prewarmTriggerReasons,
        prewarmTriggerReasonsSeen: prewarmTriggerReasons.slice(),
        prewarmDuplicateRequests: 0,
        comparisonTrigger,
        providerCurveProgressAtSubscribe: Number.isFinite(Number(state.curveProgress)) ? Number(state.curveProgress) : null,
        scoreAtSubscribe: Number.isFinite(Number(state.score)) ? Number(state.score) : null,
        subscriptionId,
        subscribedAt,
        lastRequestedAt: subscribedAt,
        expiresAt: subscribedAt + this.ttlMs,
        lastUpdateAt: null,
        firstUpdateAt: null,
        latestUpdate: null,
        lastTelemetryUpdateAt: 0,
        lastTelemetryCurveProgress: null,
        lastTelemetryBondingStage: null,
        lastTelemetryComplete: null
      });
      this.stats.subscribed += 1;
      if (decisionShadowPrewarm) this.stats.decisionShadowPrewarmSubscribed += 1;
      this.stats.active = this.subscriptions.size;
      this.emit('finalist_account_verifier.subscribed', {
        mint,
        symbol: state.symbol || null,
        bondingCurveAddress,
        selectionClass,
        selectionTrigger: decisionShadowCandidate
          ? 'emitted_paper_decision_or_executed_action'
          : decisionShadowPrewarm ? 'pre_decision_interest_or_position' : null,
        prewarmTriggerReason,
        prewarmTriggerReasons,
        prewarmToComparisonPath: decisionShadowCandidate
          ? 'DIRECT_COMPARISON_SUBSCRIPTION'
          : decisionShadowPrewarm ? 'PREWARM_ONLY' : 'NON_DECISION_SHADOW_SUBSCRIPTION',
        subscriptionId,
        score: Number.isFinite(Number(state.score)) ? Number(state.score) : null,
        curveProgress: Number.isFinite(Number(state.curveProgress)) ? Number(state.curveProgress) : null,
        commitment: this.commitment,
        ttlMs: this.ttlMs
      });
      this.captureInitialSnapshot(mint, bondingCurveAddress).catch((error) => {
        this.stats.initialSnapshotErrors += 1;
        this.emit('finalist_account_verifier.initial_snapshot_error', {
          mint,
          symbol: state.symbol || null,
          bondingCurveAddress,
          method: this.initialSnapshotMethod,
          errorMessage: error.message
        });
      });
      return true;
    } catch (error) {
      this.stats.subscribeErrors += 1;
      this.emit('finalist_account_verifier.subscribe_error', {
        mint,
        bondingCurveAddress,
        providerBondingCurveAddress,
        derivedBondingCurveAddress,
        selectionClass,
        errorMessage: error.message
      });
      return false;
    }
  }

  async captureInitialSnapshot(mint, bondingCurveAddress) {
    if (!this.initialSnapshotEnabled || !this.accountReader) {
      return false;
    }

    let publicKey;
    try {
      publicKey = new PublicKey(bondingCurveAddress);
    } catch (error) {
      this.stats.initialSnapshotErrors += 1;
      this.emit('finalist_account_verifier.initial_snapshot_error', {
        mint,
        bondingCurveAddress,
        method: this.initialSnapshotMethod,
        errorMessage: error.message
      });
      return false;
    }

    const startedAt = Date.now();
    const accountInfo = await this.readInitialSnapshot(publicKey);
    const latencyMs = Date.now() - startedAt;
    if (!accountInfo) {
      this.stats.initialSnapshotMissing += 1;
      this.emit('finalist_account_verifier.initial_snapshot_missing', {
        mint,
        bondingCurveAddress,
        commitment: this.commitment,
        method: this.initialSnapshotMethod,
        latencyMs
      });
      return false;
    }

    this.stats.initialSnapshots += 1;
    this.emit('finalist_account_verifier.initial_snapshot', {
      mint,
      bondingCurveAddress,
      commitment: this.commitment,
      method: this.initialSnapshotMethod,
      latencyMs
    });
    this.handleAccountUpdate(mint, bondingCurveAddress, accountInfo, { source: 'initial_snapshot' });
    return true;
  }

  async readInitialSnapshot(publicKey) {
    if (
      this.initialSnapshotMethod === 'getMultipleAccountsInfo'
      && typeof this.accountReader.getMultipleAccountsInfo === 'function'
    ) {
      const accounts = await this.accountReader.getMultipleAccountsInfo([publicKey], { commitment: this.commitment });
      return Array.isArray(accounts) ? accounts[0] : null;
    }

    if (typeof this.accountReader.getAccountInfo !== 'function') {
      return null;
    }

    return this.accountReader.getAccountInfo(publicKey, this.commitment);
  }

  handleAccountUpdate(mint, bondingCurveAddress, accountInfo, context = {}) {
    const now = Date.now();
    const subscription = this.subscriptions.get(mint);
    if (subscription) {
      subscription.lastUpdateAt = now;
      subscription.firstUpdateAt = subscription.firstUpdateAt || now;
      if (subscription.selectionClass !== 'decision_shadow_prewarm') {
        subscription.expiresAt = Math.max(subscription.expiresAt, now + this.ttlMs);
      }
    }

    const owner = accountInfo?.owner?.toBase58?.() || String(accountInfo?.owner || '');
    if (owner !== this.programId.toBase58()) {
      this.stats.ownerMismatches += 1;
      this.emit('finalist_account_verifier.update_invalid', {
        mint,
        bondingCurveAddress,
        owner,
        expectedOwner: this.programId.toBase58(),
      slot: context.slot ?? null,
      updateSource: context.source || 'account_subscribe',
      reason: 'UNEXPECTED_OWNER'
      });
      this.unsubscribeMint(mint, 'INVALID_OWNER');
      return;
    }

    let decoded;
    try {
      decoded = this.decodeBondingCurveAccount(accountInfo.data);
    } catch (error) {
      this.stats.decodeErrors += 1;
      this.emit('finalist_account_verifier.update_invalid', {
        mint,
        bondingCurveAddress,
        owner,
        slot: context.slot ?? null,
        updateSource: context.source || 'account_subscribe',
        reason: 'DECODE_FAILED',
        errorMessage: error.message
      });
      return;
    }

    this.stats.updates += 1;
    this.stats.freshUpdates += 1;
    const providerCurveProgressAtSubscribe = subscription?.providerCurveProgressAtSubscribe ?? null;
    const subscriptionCurveDelta = Number.isFinite(Number(providerCurveProgressAtSubscribe)) && Number.isFinite(Number(decoded.curveProgress))
      ? Number(decoded.curveProgress) - Number(providerCurveProgressAtSubscribe)
      : null;
    const updatePayload = {
      mint,
      symbol: subscription?.symbol || null,
      bondingCurveAddress,
      selectionClass: subscription?.selectionClass || null,
      owner,
      slot: context.slot ?? null,
      updateSource: context.source || 'account_subscribe',
      commitment: this.commitment,
      receivedAt: new Date(now).toISOString(),
      receivedAtMs: now,
      freshForMs: this.freshMs,
      providerCurveProgressAtSubscribe,
      scoreAtSubscribe: subscription?.scoreAtSubscribe ?? null,
      subscriptionCurveDelta,
      curveProgress: decoded.curveProgress,
      curveProgressByVirtualTokenReserves: decoded.curveProgressByVirtualTokenReserves,
      priceSol: decoded.priceSol,
      virtualSolReservesSol: decoded.virtualSolReservesSol,
      virtualTokenReservesTokens: decoded.virtualTokenReservesTokens,
      creator: decoded.creator || null,
      isMayhemMode: decoded.isMayhemMode === true,
      complete: decoded.complete,
      bondingStage: decoded.bondingStage
    };
    if (subscription) {
      subscription.latestUpdate = updatePayload;
    }
    if (this.shouldEmitUpdateTelemetry(subscription, updatePayload, context.source || 'account_subscribe', now)) {
      if (subscription) {
        subscription.lastTelemetryUpdateAt = now;
        subscription.lastTelemetryCurveProgress = Number.isFinite(Number(decoded.curveProgress)) ? Number(decoded.curveProgress) : null;
        subscription.lastTelemetryBondingStage = decoded.bondingStage || null;
        subscription.lastTelemetryComplete = decoded.complete === true;
      }
      this.emit('finalist_account_verifier.update', updatePayload);
    } else {
      this.stats.updateTelemetrySuppressed += 1;
    }
  }

  shouldEmitUpdateTelemetry(subscription, updatePayload, source, now) {
    if (!subscription || source === 'initial_snapshot') return true;
    const lastAt = Number(subscription.lastTelemetryUpdateAt || 0);
    if (!lastAt || now - lastAt >= this.updateTelemetryMinIntervalMs) return true;
    if (subscription.lastTelemetryBondingStage !== updatePayload.bondingStage) return true;
    if (subscription.lastTelemetryComplete !== (updatePayload.complete === true)) return true;
    const currentCurve = Number(updatePayload.curveProgress);
    const lastCurve = Number(subscription.lastTelemetryCurveProgress);
    if (!Number.isFinite(currentCurve) || !Number.isFinite(lastCurve)) return true;
    return Math.abs(currentCurve - lastCurve) >= this.updateTelemetryMinCurveDelta;
  }

  getLatestUpdate(mint) {
    if (!mint) return null;
    return this.subscriptions.get(mint)?.latestUpdate || null;
  }

  getSubscriptionStatus(mint) {
    const subscription = mint ? this.subscriptions.get(mint) : null;
    const comparisonRequestedAt = Number(subscription?.comparisonRequestedAt || 0) || null;
    const prewarmRequestedAt = Number(subscription?.prewarmRequestedAt || 0) || null;
    const firstUpdateAt = Number(subscription?.firstUpdateAt || 0) || null;
    return {
      subscribed: Boolean(subscription),
      hasUpdate: Boolean(subscription?.latestUpdate),
      selectionClass: subscription?.selectionClass || null,
      lastUpdateAt: subscription?.lastUpdateAt || null,
      prewarmed: prewarmRequestedAt !== null,
      prewarmRequestedAt,
      comparisonRequestedAt,
      prewarmTriggerReason: subscription?.prewarmTriggerReason || null,
      prewarmTriggerReasons: Array.isArray(subscription?.prewarmTriggerReasons)
        ? subscription.prewarmTriggerReasons.slice()
        : [],
      prewarmTriggerReasonsSeen: Array.isArray(subscription?.prewarmTriggerReasonsSeen)
        ? subscription.prewarmTriggerReasonsSeen.slice()
        : [],
      prewarmDuplicateRequests: Number(subscription?.prewarmDuplicateRequests || 0),
      comparisonTrigger: subscription?.comparisonTrigger || null,
      prewarmToComparisonPath: prewarmToComparisonPath(subscription),
      prewarmLeadMs: prewarmRequestedAt !== null && comparisonRequestedAt !== null
        ? Math.max(0, comparisonRequestedAt - prewarmRequestedAt)
        : null,
      firstUpdateBeforeComparison: firstUpdateAt !== null && comparisonRequestedAt !== null
        ? firstUpdateAt <= comparisonRequestedAt
        : null
    };
  }

  evaluateShadowGate(state = {}, meta = {}) {
    if (!this.enabled) return null;
    const mint = state.mint || state.token || state.mintAddress || meta.mint;
    if (!mint) return null;

    this.stats.shadowGateChecks += 1;
    const now = Date.now();
    const update = this.getLatestUpdate(mint);
    const accountAgeMs = update && Number.isFinite(Number(update.receivedAtMs))
      ? now - Number(update.receivedAtMs)
      : null;
    const fresh = accountAgeMs !== null && Number.isFinite(accountAgeMs) && accountAgeMs <= this.freshMs;
    const paperCurve = Number(state.curveProgress ?? state.entryCurveProgress);
    const accountCurve = Number(update?.curveProgress);
    const curveDelta = Number.isFinite(paperCurve) && Number.isFinite(accountCurve)
      ? accountCurve - paperCurve
      : null;
    const absCurveDelta = curveDelta !== null && Number.isFinite(Number(curveDelta))
      ? Math.abs(Number(curveDelta))
      : null;
    let status = 'LIVE_BLOCKED_NO_ACCOUNT_UPDATE';
    let blockedReason = 'NO_ACCOUNT_UPDATE';

    if (!update) {
      status = 'LIVE_BLOCKED_NO_ACCOUNT_UPDATE';
      blockedReason = 'NO_ACCOUNT_UPDATE';
    } else if (!fresh) {
      status = 'LIVE_BLOCKED_STALE_ACCOUNT_UPDATE';
      blockedReason = 'STALE_ACCOUNT_UPDATE';
    } else if (update?.complete === true) {
      status = 'LIVE_BLOCKED_COMPLETE';
      blockedReason = 'BONDING_CURVE_COMPLETE';
    } else if (!Number.isFinite(paperCurve) || !Number.isFinite(accountCurve)) {
      status = 'LIVE_BLOCKED_MISSING_CURVE_STATE';
      blockedReason = 'MISSING_CURVE_STATE';
    } else if (absCurveDelta !== null && absCurveDelta > this.maxCurveDelta) {
      status = 'LIVE_BLOCKED_STATE_MISMATCH';
      blockedReason = 'STATE_MISMATCH';
    } else if (fresh) {
      status = 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE';
      blockedReason = null;
    }

    if (status === 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE') {
      this.stats.shadowGateReady += 1;
    } else {
      this.stats.shadowGateBlocked += 1;
    }

    this.emit('finalist_account_verifier.shadow_live_gate', {
      mint,
      symbol: state.symbol || update?.symbol || null,
      decision: meta.decision || state.decision || null,
      reason: meta.reason || state.reason || null,
      preset: meta.preset || state.preset || null,
      lane: meta.lane || state.lane || null,
      status,
      blockedReason,
      fresh,
      freshForMs: this.freshMs,
      accountAgeMs,
      paperCurveProgress: Number.isFinite(paperCurve) ? paperCurve : null,
      accountCurveProgress: Number.isFinite(accountCurve) ? accountCurve : null,
      curveDelta,
      absCurveDelta,
      maxCurveDelta: this.maxCurveDelta,
      accountSlot: update?.slot ?? null,
      accountBondingStage: update?.bondingStage || null,
      accountComplete: update?.complete === true,
      selectionClass: update?.selectionClass || null
    });
    return { status, blockedReason, fresh, accountAgeMs, update };
  }

  pruneExpired(reason = 'expired') {
    const now = Date.now();
    for (const [mint, subscription] of Array.from(this.subscriptions.entries())) {
      if (subscription.expiresAt > now) continue;
      this.unsubscribeMint(mint, reason);
      this.stats.expired += 1;
    }
    this.stats.active = this.subscriptions.size;
  }

  unsubscribeMint(mint, reason = 'unsubscribed') {
    const subscription = this.subscriptions.get(mint);
    if (!subscription) return false;
    this.subscriptions.delete(mint);
    this.stats.unsubscribed += 1;
    this.stats.active = this.subscriptions.size;
    try {
      const result = this.connection.removeAccountChangeListener(subscription.subscriptionId);
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Listener cleanup is best-effort during report-only verification.
    }
    this.emit('finalist_account_verifier.unsubscribed', {
      mint,
      bondingCurveAddress: subscription.bondingCurveAddress,
      selectionClass: subscription.selectionClass,
      subscriptionId: subscription.subscriptionId,
      reason
    });
    return true;
  }

  stop(reason = 'stop') {
    for (const mint of Array.from(this.subscriptions.keys())) {
      this.unsubscribeMint(mint, reason);
    }
  }

  getStats() {
    this.stats.active = this.subscriptions.size;
    return {
      ...this.stats,
      subscriptions: Array.from(this.subscriptions.values()).map((subscription) => ({
        mint: subscription.mint,
        symbol: subscription.symbol,
        bondingCurveAddress: subscription.bondingCurveAddress,
        selectionClass: subscription.selectionClass,
        selectionPriority: subscription.selectionPriority,
        prewarmRequestedAt: subscription.prewarmRequestedAt
          ? new Date(subscription.prewarmRequestedAt).toISOString()
          : null,
        comparisonRequestedAt: subscription.comparisonRequestedAt
          ? new Date(subscription.comparisonRequestedAt).toISOString()
          : null,
        prewarmTriggerReason: subscription.prewarmTriggerReason || null,
        prewarmTriggerReasons: Array.isArray(subscription.prewarmTriggerReasons)
          ? subscription.prewarmTriggerReasons.slice()
          : [],
        prewarmTriggerReasonsSeen: Array.isArray(subscription.prewarmTriggerReasonsSeen)
          ? subscription.prewarmTriggerReasonsSeen.slice()
          : [],
        prewarmDuplicateRequests: Number(subscription.prewarmDuplicateRequests || 0),
        comparisonTrigger: subscription.comparisonTrigger || null,
        prewarmToComparisonPath: prewarmToComparisonPath(subscription),
        providerCurveProgressAtSubscribe: subscription.providerCurveProgressAtSubscribe,
        scoreAtSubscribe: subscription.scoreAtSubscribe,
        subscribedAt: new Date(subscription.subscribedAt).toISOString(),
        lastUpdateAt: subscription.lastUpdateAt ? new Date(subscription.lastUpdateAt).toISOString() : null,
        firstUpdateAt: subscription.firstUpdateAt ? new Date(subscription.firstUpdateAt).toISOString() : null,
        latestCurveProgress: subscription.latestUpdate?.curveProgress ?? null,
        latestSlot: subscription.latestUpdate?.slot ?? null,
        expiresAt: new Date(subscription.expiresAt).toISOString()
      }))
    };
  }
}

module.exports = FinalistAccountVerifier;
