'use strict';

const { LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const { PumpBuyV2DryRunBuilder } = require('./pump-buy-v2-dry-run-builder');
const { classifySimulationError } = require('./simulation-error-classifier');

const DEFAULT_PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const BONDING_CURVE_DISCRIMINATOR = 6966180631402821399n;
const SENTINEL_BONDING_CURVE_ADDRESSES = new Set([
  '11111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
]);

function finiteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compact(value, digits = 6) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Number(parsed.toFixed(digits));
}

function publicKeyString(value) {
  if (!value) return null;
  try {
    return value instanceof PublicKey ? value.toBase58() : new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

function normalizeQuoteMint(value) {
  const parsed = publicKeyString(value);
  return parsed || (value ? String(value).trim() : null);
}

class LiveExecutionDryRunLane {
  constructor(config, logger, options = {}) {
    this.config = config;
    this.logger = logger;
    this.connection = options.connection || null;
    this.accountReader = options.accountReader || this.connection;
    this.userPublicKey = options.userPublicKey || null;
    this.signerKeypair = options.signerKeypair || null;
    this.telemetryHook = typeof options.telemetryHook === 'function' ? options.telemetryHook : null;
    this.decodeBondingCurveAccount = typeof options.decodeBondingCurveAccount === 'function'
      ? options.decodeBondingCurveAccount
      : null;
    this.deriveBondingCurveAddress = typeof options.deriveBondingCurveAddress === 'function'
      ? options.deriveBondingCurveAddress
      : null;
    this.pumpProgramId = new PublicKey(config.pumpBondingCurveProgramId || DEFAULT_PUMP_FUN_PROGRAM_ID);
    this.enabled = config.liveDryRunEnabled === true;
    this.pumpBuyV2BuilderEnabled = config.liveDryRunPumpBuyV2BuilderEnabled !== false;
    this.pumpBuyV2Builder = this.pumpBuyV2BuilderEnabled ? new PumpBuyV2DryRunBuilder(config) : null;
    this.amountSol = finiteNumber(config.liveDryRunAmountSol, finiteNumber(config.preMigrationPaperAmountSol, 0.1));
    this.maxAccountAgeMs = Math.max(100, finiteNumber(config.liveDryRunMaxAccountAgeMs, finiteNumber(config.finalistAccountVerifierFreshMs, 1500)));
    this.maxPriceImpactPct = Math.max(0, finiteNumber(config.liveDryRunMaxPriceImpactPct, 3));
    this.maxQuoteReserveDriftPct = Math.max(0, finiteNumber(config.liveDryRunMaxQuoteReserveDriftPct, 10));
    this.maxPerRun = Math.max(0, finiteNumber(config.liveDryRunMaxPerRun, 50));
    this.mintCooldownMs = Math.max(0, finiteNumber(config.liveDryRunMintCooldownMs, 15000));
    this.simulationFailureCooldownMs = Math.max(
      this.mintCooldownMs,
      finiteNumber(config.liveDryRunSimulationFailureCooldownMs, 300000)
    );
    this.fetchBlockhash = config.liveDryRunFetchBlockhash !== false;
    this.requireTransactionBuilder = config.liveDryRunRequireTransactionBuilder !== false;
    this.simulateTransaction = config.liveDryRunSimulateTransaction === true;
    this.signForSimulation = config.liveDryRunSignForSimulation === true;
    this.simulationCommitment = config.liveDryRunSimulationCommitment || 'processed';
    this.dryRunKeypairLabel = config.liveDryRunKeypairLabel || 'hot_wallet';
    this.lastAttemptByMint = new Map();
    this.stats = {
      enabled: this.enabled,
      attempts: 0,
      wouldSend: 0,
      wouldBlock: 0,
      skipped: 0,
      errors: 0,
      blockReasons: {},
      skipReasons: {},
      amountSol: this.amountSol,
      maxAccountAgeMs: this.maxAccountAgeMs,
      maxPriceImpactPct: this.maxPriceImpactPct,
      maxQuoteReserveDriftPct: this.maxQuoteReserveDriftPct,
      maxPerRun: this.maxPerRun,
      mintCooldownMs: this.mintCooldownMs,
      simulationFailureCooldownMs: this.simulationFailureCooldownMs,
      fetchBlockhash: this.fetchBlockhash,
      requireTransactionBuilder: this.requireTransactionBuilder,
      pumpBuyV2BuilderEnabled: this.pumpBuyV2BuilderEnabled,
      simulateTransaction: this.simulateTransaction,
      signForSimulation: this.signForSimulation,
      simulationCommitment: this.simulationCommitment,
      simulations: 0,
      simulationOk: 0,
      simulationFailed: 0,
      simulationErrors: {}
    };
    this.simulationFailureByMint = new Map();
  }

  emit(type, payload = {}) {
    if (!this.telemetryHook) return;
    try {
      this.telemetryHook(type, payload);
    } catch {
      // Report-only dry-run telemetry must never affect paper/live behavior.
    }
  }

  bump(target, key) {
    const label = key || 'unknown';
    target[label] = (target[label] || 0) + 1;
  }

  shouldAttempt(mint, now) {
    if (!this.enabled) return { ok: false, reason: 'DISABLED' };
    if (!mint) return { ok: false, reason: 'MISSING_MINT' };
    if (this.maxPerRun > 0 && this.stats.attempts >= this.maxPerRun) {
      return { ok: false, reason: 'MAX_PER_RUN' };
    }
    const lastAt = Number(this.lastAttemptByMint.get(mint) || 0);
    if (this.mintCooldownMs > 0 && lastAt > 0 && now - lastAt < this.mintCooldownMs) {
      return { ok: false, reason: 'MINT_COOLDOWN' };
    }
    const lastSimulationFailureAt = Number(this.simulationFailureByMint.get(mint) || 0);
    if (
      this.simulationFailureCooldownMs > 0
      && lastSimulationFailureAt > 0
      && now - lastSimulationFailureAt < this.simulationFailureCooldownMs
    ) {
      return { ok: false, reason: 'SIMULATION_FAILURE_COOLDOWN' };
    }
    return { ok: true };
  }

  classifySimulationError(error, logs = []) {
    return classifySimulationError(error, logs, error || 'SIMULATION_FAILED');
  }

  async evaluate(state = {}, meta = {}) {
    const gate = meta.gateResult || null;
    if (gate?.status !== 'LIVE_SHADOW_READY_FRESH_ACCOUNT_STATE') {
      return null;
    }

    const mint = state.mint || state.token || state.mintAddress || meta.mint || gate.update?.mint;
    const now = Date.now();
    const attemptGate = this.shouldAttempt(mint, now);
    if (!attemptGate.ok) {
      if (attemptGate.reason !== 'DISABLED') {
        this.stats.skipped += 1;
        this.bump(this.stats.skipReasons, attemptGate.reason);
        this.emit('live_dry_run.skipped', {
          mint: mint || null,
          symbol: state.symbol || gate.update?.symbol || null,
          reason: attemptGate.reason,
          sourceDecision: meta.decision || state.decision || null
        });
      }
      return null;
    }

    this.lastAttemptByMint.set(mint, now);
    this.stats.attempts += 1;

    try {
      const update = gate.update || {};
      const accountAgeMs = Number.isFinite(Number(update.receivedAtMs))
        ? now - Number(update.receivedAtMs)
        : finiteNumber(gate.accountAgeMs);
      const basePayload = {
        mint,
        symbol: state.symbol || update.symbol || null,
        sourceDecision: meta.decision || state.decision || null,
        sourceReason: meta.reason || state.reason || null,
        preset: meta.preset || state.preset || null,
        lane: meta.lane || state.lane || null,
        accountAgeMs: compact(accountAgeMs, 0),
        maxAccountAgeMs: this.maxAccountAgeMs,
        accountSlot: update.slot ?? null,
        accountBondingStage: update.bondingStage || null,
        accountComplete: update.complete === true,
        accountCurveProgress: finiteNumber(update.curveProgress),
        paperCurveProgress: finiteNumber(state.curveProgress ?? state.entryCurveProgress),
        bondingCurveAddress: update.bondingCurveAddress || state.bondingCurveAddress || null,
        quoteMint: normalizeQuoteMint(update.quoteMint || state.quoteMint || null),
        pairBase: update.pairBase || state.pairBase || null,
        creator: update.creator || state.creator || null,
        isMayhemMode: update.isMayhemMode === true || state.isMayhemMode === true,
        amountSol: compact(this.amountSol, 6),
        keypairLabel: this.dryRunKeypairLabel,
        broadcastEnabled: false
      };

      if (!Number.isFinite(accountAgeMs) || accountAgeMs > this.maxAccountAgeMs) {
        return this.block('STALE_ACCOUNT_UPDATE', basePayload);
      }
      if (update.complete === true) {
        return this.block('BONDING_CURVE_COMPLETE', basePayload);
      }
      const quoteSupport = this.checkSolQuoteSupport(update, state);
      if (!quoteSupport.ok) {
        return this.block(quoteSupport.reason, {
          ...basePayload,
          quoteMint: quoteSupport.quoteMint,
          pairBase: quoteSupport.pairBase,
          virtualSolReservesSol: quoteSupport.virtualSolReservesSol
        });
      }

      const quote = this.computeBuyQuote(update, this.amountSol);
      if (!quote.ok) {
        return this.block(quote.reason, { ...basePayload, quote });
      }

      const payload = {
        ...basePayload,
        quote,
        priorityFeeMicroLamports: finiteNumber(this.config.priorityFee, null),
        txBuildStatus: 'not_configured',
        signedOk: false,
        simulationOk: null,
        txSizeBytes: null
      };

      if (this.fetchBlockhash) {
        try {
          const startedAt = Date.now();
          const blockhash = await this.connection?.getLatestBlockhash?.({ commitment: 'processed' });
          payload.blockhashOk = Boolean(blockhash?.blockhash);
          payload.blockhash = blockhash?.blockhash || null;
          payload.blockhashLatencyMs = Date.now() - startedAt;
          payload.lastValidBlockHeight = blockhash?.lastValidBlockHeight ?? null;
        } catch (error) {
          payload.blockhashOk = false;
          payload.blockhashError = error.message;
          return this.block('BLOCKHASH_UNAVAILABLE', payload);
        }
      }

      if (Number.isFinite(quote.priceImpactPct) && quote.priceImpactPct > this.maxPriceImpactPct) {
        return this.block('PRICE_IMPACT_TOO_HIGH', payload);
      }

      if (this.requireTransactionBuilder) {
        const txBuild = await this.tryBuildPumpBuyV2Transaction({
          mint,
          state,
          update,
          quote,
          blockhash: payload.blockhash || null
        });
        payload.txBuildStatus = txBuild.status;
        payload.txBuildReason = txBuild.reason || null;
        payload.txBuilder = txBuild.builder || null;
        payload.expectedBondingCurveAddress = txBuild.expectedBondingCurveAddress || null;
        payload.providedBondingCurveAddress = txBuild.providedBondingCurveAddress || null;
        payload.txSizeBytes = txBuild.txSizeBytes ?? null;
        payload.signedOk = false;
        payload.signatureMode = this.signForSimulation
          ? 'sign_for_simulation_pending'
          : 'not_signed_report_only';
        if (!txBuild.ok) {
          return this.block(txBuild.reason || 'TX_BUILDER_UNAVAILABLE', payload);
        }
        payload.txBuild = txBuild.summary;

        if (this.simulateTransaction) {
          const curveValidation = await this.validateBondingCurveForSimulation({
            mint,
            state,
            update,
            accountDetails: txBuild.accountDetails,
            expectedBondingCurveAddress: txBuild.expectedBondingCurveAddress || txBuild.summary?.expectedBondingCurveAddress || null,
            providedBondingCurveAddress: txBuild.providedBondingCurveAddress || txBuild.summary?.providedBondingCurveAddress || null
          });
          payload.bondingCurveValidation = curveValidation.diagnostic;
          if (!curveValidation.ok) {
            return this.block(curveValidation.reason || 'BONDING_CURVE_VALIDATION_FAILED', payload);
          }
          const reserveDrift = this.computeQuoteReserveDrift(quote, curveValidation.diagnostic);
          if (reserveDrift && reserveDrift.maxDriftPct > this.maxQuoteReserveDriftPct) {
            payload.quoteReserveDrift = reserveDrift;
            return this.block('QUOTE_RESERVE_DRIFT', payload);
          }

          const accountDiagnostic = await this.diagnoseTransactionAccounts(txBuild.accountDetails);
          if (accountDiagnostic) {
            payload.simulationAccountDiagnostic = accountDiagnostic;
            const missingNames = new Set((accountDiagnostic.missingAccounts || []).map((account) => account.name));
            if (missingNames.has('user')) {
              return this.block('USER_ACCOUNT_NOT_FOUND', payload);
            }
          }

          const transactionForSimulation = this.signForSimulation
            ? this.trySignForSimulation(txBuild.transaction)
            : { ok: true, transaction: txBuild.transaction, signatureMode: 'not_signed_report_only' };
          payload.signedOk = transactionForSimulation.ok === true && this.signForSimulation;
          payload.signatureMode = transactionForSimulation.signatureMode;
          payload.signatureError = transactionForSimulation.error || null;
          if (!transactionForSimulation.ok) {
            return this.block(transactionForSimulation.reason || 'SIGN_FOR_SIMULATION_FAILED', payload);
          }

          const simulation = await this.trySimulateTransaction(transactionForSimulation.transaction);
          payload.simulationOk = simulation.ok;
          payload.simulationLatencyMs = simulation.latencyMs;
          payload.simulationError = simulation.error || null;
          payload.simulationUnitsConsumed = simulation.unitsConsumed ?? null;
          payload.simulationLogs = simulation.logs || [];
          this.stats.simulations += 1;
          if (simulation.ok) {
            this.stats.simulationOk += 1;
          } else {
            this.stats.simulationFailed += 1;
            const classifiedSimulationError = this.classifySimulationError(simulation.error, simulation.logs);
            payload.simulationErrorClass = classifiedSimulationError;
            this.bump(this.stats.simulationErrors, classifiedSimulationError);
            if (mint) this.simulationFailureByMint.set(mint, Date.now());
            return this.block(classifiedSimulationError, payload);
          }
        }
      }

      this.stats.wouldSend += 1;
      this.emit('live_dry_run.would_send', payload);
      return { status: 'would_send', payload };
    } catch (error) {
      this.stats.errors += 1;
      this.emit('live_dry_run.error', {
        mint: mint || null,
        symbol: state.symbol || null,
        errorMessage: error.message,
        sourceDecision: meta.decision || state.decision || null
      });
      return { status: 'error', error };
    }
  }

  computeBuyQuote(update = {}, amountSol) {
    const virtualSolReservesSol = finiteNumber(update.virtualSolReservesSol);
    const virtualTokenReservesTokens = finiteNumber(update.virtualTokenReservesTokens);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      return { ok: false, reason: 'INVALID_AMOUNT_SOL' };
    }
    if (!Number.isFinite(virtualSolReservesSol) || virtualSolReservesSol <= 0 || !Number.isFinite(virtualTokenReservesTokens) || virtualTokenReservesTokens <= 0) {
      return { ok: false, reason: 'MISSING_RESERVES' };
    }

    const invariant = virtualSolReservesSol * virtualTokenReservesTokens;
    const nextVirtualSolReservesSol = virtualSolReservesSol + amountSol;
    const nextVirtualTokenReservesTokens = invariant / nextVirtualSolReservesSol;
    const estimatedTokensOut = Math.max(0, virtualTokenReservesTokens - nextVirtualTokenReservesTokens);
    const spotPriceSol = virtualSolReservesSol / virtualTokenReservesTokens;
    const averagePriceSol = estimatedTokensOut > 0 ? amountSol / estimatedTokensOut : null;
    const postTradePriceSol = nextVirtualSolReservesSol / nextVirtualTokenReservesTokens;
    const priceImpactPct = spotPriceSol > 0 && Number.isFinite(averagePriceSol)
      ? ((averagePriceSol / spotPriceSol) - 1) * 100
      : null;
    const postTradePriceMovePct = spotPriceSol > 0
      ? ((postTradePriceSol / spotPriceSol) - 1) * 100
      : null;

    return {
      ok: true,
      amountSol: compact(amountSol, 6),
      amountLamports: Math.round(amountSol * LAMPORTS_PER_SOL),
      estimatedTokensOut: compact(estimatedTokensOut, 6),
      spotPriceSol: compact(spotPriceSol, 12),
      averagePriceSol: compact(averagePriceSol, 12),
      postTradePriceSol: compact(postTradePriceSol, 12),
      priceImpactPct: compact(priceImpactPct, 4),
      postTradePriceMovePct: compact(postTradePriceMovePct, 4),
      virtualSolReservesSol: compact(virtualSolReservesSol, 6),
      virtualTokenReservesTokens: compact(virtualTokenReservesTokens, 6)
    };
  }

  checkSolQuoteSupport(update = {}, state = {}) {
    const quoteMint = normalizeQuoteMint(update.quoteMint || state.quoteMint || null);
    const pairBase = update.pairBase || state.pairBase || null;
    const virtualSolReservesSol = finiteNumber(update.virtualSolReservesSol ?? state.virtualSolReservesSol);
    const upperPairBase = pairBase ? String(pairBase).trim().toUpperCase() : null;

    if (quoteMint && quoteMint !== SOL_MINT) {
      return { ok: false, reason: 'UNSUPPORTED_QUOTE_MINT', quoteMint, pairBase, virtualSolReservesSol };
    }
    if (upperPairBase && upperPairBase !== 'SOL') {
      return { ok: false, reason: 'UNSUPPORTED_QUOTE_PAIR', quoteMint, pairBase, virtualSolReservesSol };
    }
    if (!Number.isFinite(virtualSolReservesSol) || virtualSolReservesSol <= 0) {
      return { ok: false, reason: 'MISSING_SOL_RESERVES', quoteMint, pairBase, virtualSolReservesSol };
    }
    return { ok: true, quoteMint, pairBase, virtualSolReservesSol };
  }

  computeQuoteReserveDrift(quote = {}, diagnostic = {}) {
    const quoteSol = finiteNumber(quote.virtualSolReservesSol);
    const quoteTokens = finiteNumber(quote.virtualTokenReservesTokens);
    const validationSol = finiteNumber(diagnostic.virtualSolReservesSol);
    const validationTokens = finiteNumber(diagnostic.virtualTokenReservesTokens);

    const solDriftPct = quoteSol > 0 && Number.isFinite(validationSol)
      ? Math.abs((validationSol - quoteSol) / quoteSol) * 100
      : null;
    const tokenDriftPct = quoteTokens > 0 && Number.isFinite(validationTokens)
      ? Math.abs((validationTokens - quoteTokens) / quoteTokens) * 100
      : null;
    const driftValues = [solDriftPct, tokenDriftPct].filter(Number.isFinite);
    if (driftValues.length === 0) return null;

    return {
      maxDriftPct: compact(Math.max(...driftValues), 4),
      solDriftPct: compact(solDriftPct, 4),
      tokenDriftPct: compact(tokenDriftPct, 4),
      quoteVirtualSolReservesSol: compact(quoteSol, 6),
      validationVirtualSolReservesSol: compact(validationSol, 6),
      quoteVirtualTokenReservesTokens: compact(quoteTokens, 6),
      validationVirtualTokenReservesTokens: compact(validationTokens, 6),
      maxAllowedDriftPct: compact(this.maxQuoteReserveDriftPct, 4)
    };
  }

  async getMintOwner(mint) {
    if (!mint || !this.accountReader?.getMultipleAccountsInfo) return null;
    const publicKey = mint instanceof PublicKey ? mint : new PublicKey(mint);
    const accounts = await this.accountReader.getMultipleAccountsInfo([publicKey], { commitment: 'processed' });
    const account = Array.isArray(accounts) ? accounts[0] : null;
    return account?.owner?.toBase58?.() || (account?.owner ? String(account.owner) : null);
  }

  async tryBuildPumpBuyV2Transaction({ mint, state = {}, update = {}, quote = {}, blockhash = null }) {
    if (!this.pumpBuyV2Builder) {
      return { ok: false, status: 'not_configured', reason: 'TX_BUILDER_UNAVAILABLE', builder: 'pump_buy_v2' };
    }
    if (!this.userPublicKey) {
      return { ok: false, status: 'blocked', reason: 'MISSING_USER_PUBLIC_KEY', builder: 'pump_buy_v2' };
    }

    let mintOwner = update.mintOwner || state.mintOwner || state.baseTokenProgram || null;
    if (!mintOwner) {
      try {
        mintOwner = await this.getMintOwner(mint);
      } catch (error) {
        return {
          ok: false,
          status: 'blocked',
          reason: 'MINT_OWNER_UNAVAILABLE',
          builder: 'pump_buy_v2',
          errorMessage: error.message
        };
      }
    }

    const build = this.pumpBuyV2Builder.build({
      mint,
      user: this.userPublicKey,
      bondingCurveAddress: update.bondingCurveAddress || state.bondingCurveAddress || null,
      creator: update.creator || state.creator || null,
      isMayhemMode: update.isMayhemMode === true || state.isMayhemMode === true,
      quote,
      blockhash,
      mintOwner
    });

    if (!build.ok) {
      return {
        ok: false,
        status: 'blocked',
        reason: build.reason || 'TX_BUILD_FAILED',
        builder: 'pump_buy_v2',
        baseTokenProgram: build.baseTokenProgram || mintOwner || null,
        expectedBondingCurveAddress: build.expectedBondingCurveAddress || null,
        providedBondingCurveAddress: build.providedBondingCurveAddress || null
      };
    }

    return {
      ok: true,
      status: 'built_unsigned',
      builder: 'pump_buy_v2',
      transaction: build.transaction,
      txSizeBytes: build.txSizeBytes,
      accountDetails: build.accountDetails || [],
      expectedBondingCurveAddress: build.expectedBondingCurveAddress || null,
      providedBondingCurveAddress: build.providedBondingCurveAddress || null,
      summary: {
        builder: 'pump_buy_v2',
        accountCount: build.accountCount,
        writableAccounts: build.writableAccounts,
        signerAccounts: build.signerAccounts,
        txSizeBytes: build.txSizeBytes,
        setupInstructionCount: build.setupInstructionCount ?? 0,
        baseTokenProgram: build.baseTokenProgram,
        expectedBondingCurveAddress: build.expectedBondingCurveAddress,
        providedBondingCurveAddress: build.providedBondingCurveAddress,
        quoteMint: build.quoteMint,
        quoteTokenProgram: build.quoteTokenProgram,
        feeRecipient: build.feeRecipient,
        buybackFeeRecipient: build.buybackFeeRecipient,
        creatorVault: build.creatorVault,
        associatedBaseUser: build.associatedBaseUser,
        associatedQuoteUser: build.associatedQuoteUser,
        expectedTokensOutRaw: build.expectedTokensOutRaw,
        minTokensOutRaw: build.minTokensOutRaw,
        quoteLamports: build.quoteLamports,
        maxQuoteLamports: build.maxQuoteLamports,
        slippageBps: build.slippageBps,
        instructionDiscriminator: build.instructionDiscriminator,
        accounts: build.accountDetails || []
      }
    };
  }

  async trySimulateTransaction(transaction) {
    if (!transaction || typeof this.connection?.simulateTransaction !== 'function') {
      return { ok: false, error: 'SIMULATION_UNAVAILABLE', latencyMs: null };
    }

    const startedAt = Date.now();
    try {
      // web3.js v1.x only accepts config objects for VersionedTransaction simulation.
      // These Pump dry-run transactions are legacy Transaction objects. They may
      // be signed locally for simulation, but this lane never broadcasts them.
      const result = await this.connection.simulateTransaction(transaction);
      const value = result?.value || {};
      return {
        ok: !value.err,
        error: value.err ? JSON.stringify(value.err) : null,
        latencyMs: Date.now() - startedAt,
        unitsConsumed: value.unitsConsumed ?? null,
        logs: Array.isArray(value.logs) ? value.logs.slice(-12) : []
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || 'SIMULATION_THROW',
        latencyMs: Date.now() - startedAt,
        unitsConsumed: null,
        logs: []
      };
    }
  }

  trySignForSimulation(transaction) {
    if (!transaction || typeof transaction.sign !== 'function') {
      return {
        ok: false,
        reason: 'SIGN_FOR_SIMULATION_UNAVAILABLE',
        signatureMode: 'sign_for_simulation_failed',
        error: 'transaction.sign unavailable'
      };
    }
    if (!this.signerKeypair) {
      return {
        ok: false,
        reason: 'SIGNER_KEYPAIR_UNAVAILABLE',
        signatureMode: 'signer_unavailable_report_only',
        error: 'missing signer keypair'
      };
    }

    try {
      transaction.sign(this.signerKeypair);
      return {
        ok: true,
        transaction,
        signatureMode: 'signed_for_simulation_report_only'
      };
    } catch (error) {
      return {
        ok: false,
        reason: 'SIGN_FOR_SIMULATION_FAILED',
        signatureMode: 'sign_for_simulation_failed',
        error: error.message || 'sign failed'
      };
    }
  }

  async diagnoseTransactionAccounts(accountDetails = []) {
    if (!Array.isArray(accountDetails) || accountDetails.length === 0 || typeof this.accountReader?.getMultipleAccountsInfo !== 'function') {
      return null;
    }

    try {
      const pubkeys = accountDetails.map((account) => new PublicKey(account.pubkey));
      const infos = await this.accountReader.getMultipleAccountsInfo(pubkeys, { commitment: 'processed' });
      const missing = [];
      const present = [];
      for (let i = 0; i < accountDetails.length; i += 1) {
        const detail = accountDetails[i] || {};
        const row = {
          name: detail.name || `account_${i}`,
          pubkey: detail.pubkey || pubkeys[i]?.toBase58?.() || null,
          isSigner: detail.isSigner === true,
          isWritable: detail.isWritable === true
        };
        if (infos?.[i]) {
          present.push(row);
        } else {
          missing.push(row);
        }
      }
      return {
        checked: accountDetails.length,
        present: present.length,
        missing: missing.length,
        missingAccounts: missing.slice(0, 12)
      };
    } catch (error) {
      return {
        checked: accountDetails.length,
        error: error.message || 'ACCOUNT_DIAGNOSTIC_FAILED'
      };
    }
  }

  decodeBondingCurveForValidation(data) {
    const decoded = this.decodeBondingCurveAccount ? this.decodeBondingCurveAccount(data) : null;
    if (decoded) return decoded;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (buffer.length < 49) throw new Error(`bonding curve account too small: ${buffer.length}`);
    const discriminator = buffer.readBigUInt64LE(0);
    if (discriminator !== BONDING_CURVE_DISCRIMINATOR) {
      throw new Error(`unexpected discriminator ${discriminator.toString()}`);
    }
    let offset = 8;
    const virtualTokenReservesRaw = buffer.readBigUInt64LE(offset); offset += 8;
    const virtualSolReservesRaw = buffer.readBigUInt64LE(offset); offset += 8;
    const realTokenReservesRaw = buffer.readBigUInt64LE(offset); offset += 8;
    const realSolReservesRaw = buffer.readBigUInt64LE(offset); offset += 8;
    const tokenTotalSupplyRaw = buffer.readBigUInt64LE(offset); offset += 8;
    const complete = buffer[offset] === 1;
    return {
      discriminator: discriminator.toString(),
      virtualTokenReservesTokens: Number(virtualTokenReservesRaw) / 1e6,
      virtualSolReservesSol: Number(virtualSolReservesRaw) / LAMPORTS_PER_SOL,
      realTokenReservesTokens: Number(realTokenReservesRaw) / 1e6,
      realSolReservesSol: Number(realSolReservesRaw) / LAMPORTS_PER_SOL,
      tokenTotalSupplyTokens: Number(tokenTotalSupplyRaw) / 1e6,
      complete
    };
  }

  async validateBondingCurveForSimulation({
    mint,
    state = {},
    update = {},
    accountDetails = [],
    expectedBondingCurveAddress = null,
    providedBondingCurveAddress = null
  }) {
    const bondingDetail = Array.isArray(accountDetails)
      ? accountDetails.find((account) => account?.name === 'bonding_curve')
      : null;
    const provided = publicKeyString(
      bondingDetail?.pubkey
      || providedBondingCurveAddress
      || update.bondingCurveAddress
      || state.bondingCurveAddress
    );
    let expected = publicKeyString(expectedBondingCurveAddress);
    if (!expected && this.deriveBondingCurveAddress && mint) {
      try {
        expected = publicKeyString(this.deriveBondingCurveAddress(mint));
      } catch {
        expected = null;
      }
    }
    const diagnostic = {
      checked: true,
      mint: mint || null,
      bondingCurveAddress: provided,
      expectedBondingCurveAddress: expected,
      source: bondingDetail?.pubkey ? 'tx_account_details' : 'state_update'
    };
    if (!provided) {
      return { ok: false, reason: 'BONDING_CURVE_ACCOUNT_DETAIL_MISSING', diagnostic };
    }
    if (SENTINEL_BONDING_CURVE_ADDRESSES.has(provided)) {
      diagnostic.sentinel = true;
      return { ok: false, reason: 'BONDING_CURVE_SENTINEL_ADDRESS', diagnostic };
    }
    if (expected && provided !== expected) {
      diagnostic.mismatch = true;
      return { ok: false, reason: 'BONDING_CURVE_ADDRESS_MISMATCH', diagnostic };
    }
    if (typeof this.accountReader?.getMultipleAccountsInfo !== 'function') {
      diagnostic.skipped = 'ACCOUNT_READER_UNAVAILABLE';
      return { ok: true, diagnostic };
    }

    try {
      const pubkey = new PublicKey(provided);
      const startedAt = Date.now();
      const infos = await this.accountReader.getMultipleAccountsInfo([pubkey], { commitment: 'processed' });
      const account = Array.isArray(infos) ? infos[0] : null;
      diagnostic.fetchLatencyMs = Date.now() - startedAt;
      if (!account) return { ok: false, reason: 'BONDING_CURVE_ACCOUNT_NOT_FOUND', diagnostic };
      const owner = account.owner?.toBase58?.() || (account.owner ? String(account.owner) : null);
      diagnostic.owner = owner;
      if (owner && owner !== this.pumpProgramId.toBase58()) {
        return { ok: false, reason: 'BONDING_CURVE_OWNER_MISMATCH', diagnostic };
      }
      const decoded = this.decodeBondingCurveForValidation(account.data);
      diagnostic.complete = decoded.complete === true;
      diagnostic.curveProgress = compact(decoded.curveProgress, 6);
      diagnostic.virtualSolReservesSol = compact(decoded.virtualSolReservesSol, 6);
      diagnostic.virtualTokenReservesTokens = compact(decoded.virtualTokenReservesTokens, 6);
      diagnostic.realSolReservesSol = compact(decoded.realSolReservesSol, 6);
      diagnostic.creator = decoded.creator || null;
      diagnostic.isMayhemMode = decoded.isMayhemMode === true;
      if (diagnostic.complete) return { ok: false, reason: 'BONDING_CURVE_COMPLETE', diagnostic };
      if (
        !Number.isFinite(Number(decoded.virtualSolReservesSol))
        || Number(decoded.virtualSolReservesSol) <= 0
        || !Number.isFinite(Number(decoded.virtualTokenReservesTokens))
        || Number(decoded.virtualTokenReservesTokens) <= 0
      ) {
        return { ok: false, reason: 'BONDING_CURVE_RESERVES_INVALID', diagnostic };
      }
      return { ok: true, diagnostic };
    } catch (error) {
      diagnostic.error = error.message || 'BONDING_CURVE_VALIDATION_THROW';
      return { ok: false, reason: 'BONDING_CURVE_DECODE_FAILED', diagnostic };
    }
  }

  block(reason, payload = {}) {
    this.stats.wouldBlock += 1;
    this.bump(this.stats.blockReasons, reason);
    const eventPayload = {
      ...payload,
      reason,
      broadcastEnabled: false
    };
    this.emit('live_dry_run.would_block', eventPayload);
    return { status: 'would_block', reason, payload: eventPayload };
  }

  getStats() {
    return {
      ...this.stats,
      activeCooldownMints: this.lastAttemptByMint.size
    };
  }
}

module.exports = LiveExecutionDryRunLane;
