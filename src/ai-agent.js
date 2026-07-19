const fs = require('fs');
const path = require('path');
const axios = require('axios');

class AIAgent {
    constructor(config, logger) {
      this.config = config;
      this.model = config.ollamaModel || 'llama3.2:3b';
      this.logger = logger;
      this.apiEndpoint = `${config.ollamaHost}/api/chat`;
    this.telemetryHook = config.telemetryHook || null;
    this.conversationHistory = [];
    this.knowledgeDir = path.join(process.cwd(), 'knowledge');
    this.knowledgeCache = new Map();
  }

  async analyzeMarket(marketData, tokenData, currentPositions) {
    const prompt = this.buildMarketAnalysisPrompt(marketData, tokenData, currentPositions);
    
    try {
      const response = await this.sendMessage(prompt);
      return this.parseAnalysisResponse(response);
    } catch (error) {
      this.logger.error('AI analysis failed', error.message);
      throw error;
    }
  }

  async reviewTrade(tokenInfo, signal) {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          approved: !this.config.aiTimeoutDefaultsToVeto,
          confidence: 0,
          reason: 'OLLAMA_TIMEOUT',
          timeout: true,
          primaryStrategy: 'NONE',
          convergenceScore: 0,
          action: this.config.aiTimeoutDefaultsToVeto ? 'REJECT' : 'WATCH',
          strategyScores: this.buildEmptyStrategyScores(),
          contradictions: ['AI timeout'],
          executionProfile: this.buildDefaultExecutionProfile()
        });
      }, this.config.aiTimeoutMs);
    });

    const reviewPromise = this.callTradeReviewer(tokenInfo, signal);
    const result = await Promise.race([reviewPromise, timeoutPromise]);
    if (!result?.timeout) {
      return result;
    }

    this.logger.warn('Primary AI review timed out, retrying with lightweight review');

    try {
      const lightweightResult = await this.callTradeReviewer(tokenInfo, signal, {
        lightweight: true
      });
      if (lightweightResult.reason === 'AI_REVIEW_FAILED') {
        return {
          ...lightweightResult,
          reason: 'AI_REVIEW_TIMEOUT',
          timeout: true,
          contradictions: Array.from(new Set([
            ...(Array.isArray(lightweightResult.contradictions) ? lightweightResult.contradictions : []),
            'AI timeout after lightweight retry'
          ]))
        };
      }
      return lightweightResult;
    } catch (error) {
      this.logger.warn('Lightweight AI retry failed', error.message);
      return result;
    }
  }

  async warmup() {
    try {
      const startedAt = Date.now();
      await this.sendMessage(
        'Return {"approved":true,"confidence":1,"reason":"warm","primaryStrategy":"RUNNER_HUNTER","convergenceScore":1,"action":"ENTER","strategyScores":{"RUNNER_HUNTER":1,"SNIPER":0.5,"SCALPER":0.2,"MIGRATION_HUNTER":0.1,"WALLET_FLOW":0.1},"contradictions":[],"executionProfile":{"entryUrgency":"medium","expectedHold":"short","exitStyle":"fixed"}}',
        'You are a fast JSON-only health check. Do not think. Do not explain.',
        {
          timeout: this.config.aiWarmupTimeoutMs,
          numPredict: 96
        }
      );
      this.logger.info(`Ollama model warmed: ${this.model} (${Date.now() - startedAt}ms)`);
      return true;
    } catch (error) {
      this.logger.warn('Ollama warmup failed', error.message);
      return false;
    }
  }

  async callTradeReviewer(tokenInfo, signal, options = {}) {
    const reviewOptions = {
      ...options,
      fastRunner: Boolean(options.fastRunner || this.shouldUseFastRunnerReview(tokenInfo, signal))
    };
    if (reviewOptions.fastRunner) {
      reviewOptions.lightweight = true;
    }

    const reviewPacket = this.buildTradeReviewPacket(tokenInfo, signal, reviewOptions);
    const knowledgeContext = this.buildTradeKnowledgeContext(tokenInfo, signal, reviewOptions);
    const prompt = reviewOptions.fastRunner
      ? `Fast review this PumpPortal runner candidate. Return JSON only.

Candidate JSON:
${JSON.stringify(reviewPacket)}`
      : `Analyze this Solana memecoin trade candidate.

Knowledge Context:
${knowledgeContext}

Candidate JSON:
${JSON.stringify(reviewPacket)}

Return one compact JSON object only.`;

    try {
      const parsed = await this.requestTradeReviewJson(prompt, reviewOptions);
      return this.normalizeTradeReview(parsed);
    } catch (error) {
      this.logger.warn('Trade review failed', error.message);
      return {
        approved: false,
        confidence: 0,
        reason: 'AI_REVIEW_FAILED',
        primaryStrategy: 'NONE',
        convergenceScore: 0,
        action: 'REJECT',
        strategyScores: this.buildEmptyStrategyScores(),
        contradictions: ['AI review failure'],
        executionProfile: this.buildDefaultExecutionProfile()
      };
    }
  }

  shouldUseFastRunnerReview(tokenInfo = {}, signal = {}) {
    if (!this.config.aiFastRunnerReviewEnabled) {
      return false;
    }

    const source = String(tokenInfo?.source || signal?.source || '');
    const isPumpPortal = source.startsWith('pumpportal');
    const momentumScore = Number(signal?.momentumScore || tokenInfo?.momentumScore || 0);

    return isPumpPortal && momentumScore >= 0.75;
  }

  async requestTradeReviewJson(prompt, options = {}) {
    const systemPrompt = options.fastRunner
      ? this.buildFastRunnerReviewSystemPrompt()
      : this.buildTradeReviewSystemPrompt();
    const response = await this.sendMessage(
      prompt,
      systemPrompt,
        {
          numPredict: options.fastRunner
            ? this.config.aiFastReviewNumPredict
            : (options.lightweight ? 120 : 180),
          timeout: options.lightweight
          ? Math.max(1200, options.fastRunner
            ? this.config.aiFastReviewTimeoutMs
            : Math.floor(this.config.aiTimeoutMs * 0.85))
          : this.config.aiTimeoutMs
        }
      );

    try {
      return this.parseTradeReviewResponse(response);
    } catch (error) {
      this.logger.warn('Trade review parse failed, retrying once with JSON repair prompt', error.message);

      const repairPrompt = `Your previous response was not valid JSON.

Return exactly one valid JSON object that matches the required schema.
Do not include markdown.
Do not include comments.
Do not include any text before or after the JSON object.

Candidate JSON:
${prompt.match(/Candidate JSON:\n([\s\S]*)$/)?.[1] || ''}
`;

      const repairedResponse = await this.sendMessage(
        repairPrompt,
        `${systemPrompt}

You must return syntactically valid JSON. If uncertain because the setup is ambiguous or your prior formatting failed, return a minimal valid WATCH object with low confidence rather than a REJECT.`,
        {
          numPredict: options.lightweight ? 96 : 140,
          timeout: options.lightweight
            ? Math.max(1200, options.fastRunner
              ? this.config.aiFastReviewTimeoutMs
              : Math.floor(this.config.aiTimeoutMs * 0.75))
            : this.config.aiTimeoutMs
        }
      );

      return this.parseTradeReviewResponse(repairedResponse);
    }
  }

  buildTradeReviewSystemPrompt() {
    return `You are a strategy-aware Solana trade auditor for a memecoin bot.

You must evaluate every candidate through five archetypes:
- RUNNER_HUNTER
- SNIPER
- SCALPER
- MIGRATION_HUNTER
- WALLET_FLOW

Rules:
- Return JSON only.
- Be compact.
- Do not explain outside JSON.
- Score each strategy from 0 to 1.
- Use the input only; do not invent external data.
- When walletFlow is present, use it as supporting context for WALLET_FLOW and for contradiction detection.
- When walletFlow.supportTier is TRUSTED_FLOW, treat it as supporting evidence, not guaranteed approval.
- When walletFlow.supportTier is AVOID_FLOW, treat it as a serious caution flag unless other evidence is unusually strong.
- Mixed or conflicting wallet tiers should reduce confidence and can justify WATCH.
- Use walletFlow.learningSignals and walletFlow.cautionSignals as behavior clues:
  - trusted aggressive pump traders support early momentum setups
  - trusted active rotators support cleaner continuation setups
  - ops-heavy, transfer-heavy, or historically rejected wallet overlap should reduce confidence sharply
- When rickContext.supportTier is STRUCTURED_SUPPORT, treat it as structured supporting evidence, not guaranteed approval.
- When rickContext.supportTier is STRUCTURED_CAUTION, treat it as a meaningful caution signal, especially when deployer or holder context looks bad.
- When launchIntel is present, treat it as descriptive early-launch context only.
- Repeated early buyers, crowded first waves, and active repeat deployers are cautionary context, not automatic vetoes by themselves.
- The deterministic engine has already applied hard safety gates before calling you.
- If liquidityUsd is at or above minLiquidityUsd, do not reject only for "thin liquidity". Treat suboptimal liquidity above the floor as a confidence reducer or contradiction, not an automatic veto.
- Reject for liquidity only when the candidate is below the deterministic floor, unquoteable, or liquidity is paired with another stronger structural problem.
- "approved" should be true only when the setup is tradeable.
- "action" must be one of ENTER, WATCH, REJECT.

Return exactly this shape:
{
  "approved": true,
  "confidence": 0.0,
  "reason": "short sentence",
  "primaryStrategy": "RUNNER_HUNTER",
  "convergenceScore": 0.0,
  "action": "ENTER",
  "strategyScores": {
    "RUNNER_HUNTER": 0.0,
    "SNIPER": 0.0,
    "SCALPER": 0.0,
    "MIGRATION_HUNTER": 0.0,
    "WALLET_FLOW": 0.0
  },
  "contradictions": ["short note"],
  "executionProfile": {
    "entryUrgency": "low|medium|high",
    "expectedHold": "scalp|short|short_to_medium|medium",
    "exitStyle": "fixed|tight_invalidation|trailing_runner|migration_hold|flow_follow"
  }
}`;
  }

  buildFastRunnerReviewSystemPrompt() {
    return `You are a fast JSON-only Solana memecoin runner auditor.

Use only the candidate JSON. Do not explain. Do not use markdown.
The deterministic engine already passed hard safety gates before this review.
Reject only for clear structural risk, weak runner conviction, or contradiction.
If evidence is mixed but tradeable, use WATCH.

Return exactly one compact JSON object:
{"approved":true,"confidence":0.0,"reason":"short","primaryStrategy":"RUNNER_HUNTER","convergenceScore":0.0,"action":"ENTER","strategyScores":{"RUNNER_HUNTER":0.0,"SNIPER":0.0,"SCALPER":0.0,"MIGRATION_HUNTER":0.0,"WALLET_FLOW":0.0},"contradictions":[],"executionProfile":{"entryUrgency":"high","expectedHold":"short_to_medium","exitStyle":"trailing_runner"}}`;
  }

  buildTradeKnowledgeContext(tokenInfo, signal, options = {}) {
    if (options.fastRunner) {
      return [
        'Fast runner rules:',
        '- Favor high momentum, buy balance, recent volume, and repeat/KOL support.',
        '- Treat thin-but-above-floor liquidity as caution, not automatic rejection.',
        '- Reject obvious sell pressure, bad holder/deployer context, stale setup, or no clear runner lane.'
      ].join('\n');
    }

    const sections = [];
    const fileNames = options.lightweight
      ? [
        'strategy-lanes.md',
        'decision-rules.md'
      ]
      : [
        'market-mechanics.md',
        'strategy-lanes.md',
        'decision-rules.md'
      ];

    if (!options.lightweight && (signal?.momentumScore > 0 || signal?.qualityScore > 0)) {
      fileNames.push('bot-learnings.md');
      fileNames.push('trade-lessons.md');
      fileNames.push('regime-playbooks.md');
    }

    if (tokenInfo?.walletFlowSummary) {
      fileNames.push('wallet-intel.md');
      fileNames.push('kolscan-wallet-lessons.md');
    }

    if (tokenInfo?.rickContextSummary) {
      fileNames.push('rick-signals.md');
    }

    if (tokenInfo?.narrativeSummary || tokenInfo?.socialSummary) {
      fileNames.push('narrative-signals.md');
    }

    for (const fileName of fileNames) {
      const content = this.readKnowledgeFile(fileName);
      if (!content) {
        continue;
      }

      const cappedContent = options.lightweight ? content.slice(0, 1200) : content;
      sections.push(`## ${fileName}\n${cappedContent}`);
    }

    if (sections.length === 0) {
      return 'No local knowledge context available.';
    }

    return sections.join('\n\n');
  }

  readKnowledgeFile(fileName) {
    try {
      const filePath = path.join(this.knowledgeDir, fileName);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const stat = fs.statSync(filePath);
      const cached = this.knowledgeCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        return cached.content;
      }

      const content = fs.readFileSync(filePath, 'utf8').trim();
      this.knowledgeCache.set(filePath, {
        mtimeMs: stat.mtimeMs,
        content
      });
      return content;
    } catch (error) {
      this.logger.warn(`Failed to read knowledge file ${fileName}`, error.message);
      return null;
    }
  }

  buildTradeReviewPacket(tokenInfo, signal, options = {}) {
    const recentBuys = Number(tokenInfo.recentBuys || tokenInfo.buys || 0);
    const recentSells = Number(tokenInfo.recentSells || tokenInfo.sells || 0);
    const totalRecent = recentBuys + recentSells;
    const buyRatio = totalRecent > 0 ? recentBuys / totalRecent : 0.5;
    const walletFlow = tokenInfo.walletFlowSummary || null;
    const rickContext = tokenInfo.rickContextSummary || null;
    const narrative = tokenInfo.narrativeSummary || null;
    const socialSummary = tokenInfo.telegramSummary || null;
    const launchIntel = tokenInfo.launchIntelSummary || null;
    const poolState = tokenInfo.poolStateSummary || launchIntel?.poolState || null;
    const preMigrationState = tokenInfo.preMigrationState || launchIntel?.preMigrationState || null;

    const packet = {
      token: {
        mint: tokenInfo.mintAddress,
        symbol: tokenInfo.symbol || null,
        name: tokenInfo.name || null,
        source: tokenInfo.source || 'unknown',
        bondingStage: tokenInfo.bondingStage || null,
        routeType: tokenInfo.routeType || null
      },
      market: {
        priceSol: Number(tokenInfo.price || 0),
        volumeSol: Number(tokenInfo.volume || tokenInfo.volume24h || 0),
        liquiditySol: Number(tokenInfo.liquidity || 0),
        liquidityUsd: Number(tokenInfo.liquidityUsd || 0),
        minLiquidityUsd: Number(this.config.minLiquidityUsd || 0),
        riskScore: Number(tokenInfo.riskScore || 0),
        quoteable: tokenInfo.quoteable !== false,
        tokenAgeSeconds: Number(tokenInfo.tokenAgeSeconds || 0),
        recentTradeCount: Number(tokenInfo.recentTradeCount || 0),
        recentBuys,
        recentSells,
        recentVolumeSol: Number(tokenInfo.recentVolumeSol || 0),
        tradeVelocityPerMin: Number(tokenInfo.tradeVelocityPerMin || 0),
        buyRatio: Number.isFinite(buyRatio) ? Number(buyRatio.toFixed(4)) : 0.5,
        top10HolderPercent: this.normalizeOptionalNumber(tokenInfo.top10HolderPercent),
        devHoldingPercent: this.normalizeOptionalNumber(tokenInfo.devHoldingPercent)
      },
      poolState: this.buildCompactPoolState(poolState),
      preMigration: this.buildCompactPreMigrationState(preMigrationState),
      deterministicSignal: {
        action: signal.action,
        amountSol: Number(signal.amount || 0),
        qualityScore: Number(signal.qualityScore || 0),
        momentumScore: Number(signal.momentumScore || 0),
        reasoning: signal.reasoning || ''
      },
      launchIntel: this.buildCompactLaunchIntel(launchIntel, options),
      walletFlow: options.lightweight ? this.buildCompactSupplementalContext(walletFlow) : walletFlow,
      rickContext: options.lightweight ? this.buildCompactSupplementalContext(rickContext) : rickContext,
      narrative: options.lightweight ? this.buildCompactSupplementalContext(narrative) : narrative,
      socialSummary: options.lightweight ? this.buildCompactSupplementalContext(socialSummary) : socialSummary
    };

    if (!options.fastRunner) {
      return packet;
    }

    return {
      token: packet.token,
      market: packet.market,
      preMigration: packet.preMigration,
      deterministicSignal: packet.deterministicSignal,
      launchIntel: packet.launchIntel,
      walletFlow: packet.walletFlow
        ? {
            supportTier: packet.walletFlow.supportTier || null,
            cautionSignals: Array.isArray(packet.walletFlow.cautionSignals)
              ? packet.walletFlow.cautionSignals.slice(0, 3)
              : [],
            learningSignals: Array.isArray(packet.walletFlow.learningSignals)
              ? packet.walletFlow.learningSignals.slice(0, 3)
              : []
          }
        : null,
      rickContext: packet.rickContext
        ? {
            supportTier: packet.rickContext.supportTier || null,
            mentions: Number(packet.rickContext.mentions || packet.rickContext.mentionCount || 0)
          }
        : null
    };
  }

  buildCompactPreMigrationState(preMigrationState) {
    if (!preMigrationState || typeof preMigrationState !== 'object') {
      return null;
    }

    return {
      score: Number(preMigrationState.score || 0),
      flagged: Boolean(preMigrationState.flagged),
      reasons: Array.isArray(preMigrationState.reasons) ? preMigrationState.reasons.slice(0, 8) : [],
      curveProgress: preMigrationState.curveProgress ?? null,
      bondingStage: preMigrationState.bondingStage || null,
      firstSeenAt: preMigrationState.firstSeenAt || null,
      lastSeenAt: preMigrationState.lastSeenAt || null,
      lastFlaggedAt: preMigrationState.lastFlaggedAt || null,
      recentTradeCount: Number(preMigrationState.recentTradeCount || 0),
      recentBuys: Number(preMigrationState.recentBuys || 0),
      recentSells: Number(preMigrationState.recentSells || 0),
      recentVolumeSol: Number(preMigrationState.recentVolumeSol || 0),
      tradeVelocityPerMin: Number(preMigrationState.tradeVelocityPerMin || 0),
      externalMentionCount: Number(preMigrationState.externalMentionCount || 0),
      kolFirstWaveCount: Number(preMigrationState.kolFirstWaveCount || 0),
      bundlerCandidate: Boolean(preMigrationState.bundlerCandidate)
    };
  }

  buildCompactPoolState(poolState) {
    if (!poolState || typeof poolState !== 'object') {
      return null;
    }

    return {
      firstSeenAt: poolState.firstSeenAt || null,
      lastSeenAt: poolState.lastSeenAt || null,
      bestLiquidityUsd: Number(poolState.bestLiquidityUsd || 0),
      bestVolume24h: Number(poolState.bestVolume24h || 0),
      poolCount: Number(poolState.poolCount || 0),
      bestPool: poolState.bestPool
        ? {
            source: poolState.bestPool.source || null,
            poolType: poolState.bestPool.poolType || null,
            liquidityUsd: Number(poolState.bestPool.liquidityUsd || 0),
            volume24h: Number(poolState.bestPool.volume24h || 0),
            price: Number(poolState.bestPool.price || 0)
          }
        : null
    };
  }

  buildCompactLaunchIntel(launchIntel, options = {}) {
    if (!launchIntel || typeof launchIntel !== 'object') {
      return null;
    }

    const heuristics = launchIntel.heuristics || {};
    const deployerHistory = launchIntel.deployerHistory || null;
    const repeatEarlyBuyerSummary = Array.isArray(launchIntel.repeatEarlyBuyerSummary)
      ? launchIntel.repeatEarlyBuyerSummary
      : [];

    const compact = {
      tokenAgeContext: {
        createdAt: launchIntel.createdAt || null,
        firstTradeAt: launchIntel.firstTradeAt || null,
        tradeCount: Number(launchIntel.tradeCount || 0),
        uniqueBuyerCount: Number(launchIntel.uniqueBuyerCount || 0)
      },
      firstWave: {
        buyCount: Number(heuristics.firstWaveBuyCount || 0),
        distinctWalletCount: Number(heuristics.firstWaveDistinctWalletCount || 0),
        crowdingLevel: heuristics.firstWaveCrowding?.level || 'none',
        crowded: Boolean(heuristics.firstWaveCrowding?.crowded)
      },
      sniper: {
        presence: Boolean(heuristics.sniperPresence),
        walletCount: Number(heuristics.sniperWalletCount || 0),
        crowdingLevel: heuristics.sniperCrowdingLevel || 'none'
      },
      repeatedEarlyBuyers: {
        count: Number(heuristics.repeatedEarlyBuyerCount || 0),
        wallets: Array.isArray(heuristics.repeatedEarlyBuyerWallets)
          ? heuristics.repeatedEarlyBuyerWallets.slice(0, options.lightweight ? 3 : 5)
          : [],
        summary: repeatEarlyBuyerSummary
          .slice(0, options.lightweight ? 2 : 4)
          .map((entry) => ({
            wallet: entry.wallet,
            totalLaunches: Number(entry.totalLaunches || 0),
            totalBuyCount: Number(entry.totalBuyCount || 0),
            totalVolumeSol: Number(entry.totalVolumeSol || 0)
          }))
      },
      kolOverlap: {
        firstWaveCount: Number(heuristics.kolOverlap?.firstWaveCount || 0),
        trustedCount: Number(heuristics.kolOverlap?.trustedCount || 0),
        avoidCount: Number(heuristics.kolOverlap?.avoidCount || 0),
        firstWaveWallets: Array.isArray(heuristics.kolOverlap?.firstWaveWallets)
          ? heuristics.kolOverlap.firstWaveWallets.slice(0, options.lightweight ? 2 : 4)
          : [],
        repeatedWalletCount: Number(heuristics.kolOverlap?.repeatedWalletCount || 0),
        repeatedWallets: Array.isArray(heuristics.kolOverlap?.repeatedWallets)
          ? heuristics.kolOverlap.repeatedWallets.slice(0, options.lightweight ? 2 : 4)
          : []
      },
      deployer: {
        wallet: launchIntel.deployerWallet || heuristics.deployer?.wallet || null,
        activityCount: Number(heuristics.deployer?.activityCount || 0),
        buyCount: Number(heuristics.deployer?.buyCount || 0),
        sellCount: Number(heuristics.deployer?.sellCount || 0),
        netVolumeSol: Number(heuristics.deployer?.netVolumeSol || 0),
        history: deployerHistory
          ? {
              totalTokens: Number(deployerHistory.totalTokens || 0),
              recentLaunches: Array.isArray(deployerHistory.recentLaunches)
                ? deployerHistory.recentLaunches.slice(0, options.lightweight ? 2 : 4)
                : []
            }
          : null
      },
      bundler: {
        candidate: Boolean(heuristics.bundlerCandidate),
        walletCount: Number(heuristics.bundlerWalletCount || 0),
        evidenceMode: heuristics.bundlerEvidence?.mode || null
      }
    };

    return compact;
  }

  buildCompactSupplementalContext(value) {
    if (!value || typeof value !== 'object') {
      return value || null;
    }

    const compact = { ...value };
    if (Array.isArray(compact.snippets)) {
      compact.snippets = compact.snippets.slice(-1);
    }
    if (Array.isArray(compact.wallets)) {
      compact.wallets = compact.wallets.slice(0, 2);
    }
    if (Array.isArray(compact.matches)) {
      compact.matches = compact.matches.slice(0, 2);
    }

    return compact;
  }

  normalizeTradeReview(parsed) {
    const strategyScores = this.normalizeStrategyScores(parsed.strategyScores);
    const primaryStrategy = this.normalizePrimaryStrategy(
      parsed.primaryStrategy,
      strategyScores
    );
    const convergenceScore = this.normalizeUnitInterval(
      parsed.convergenceScore,
      this.calculateConvergenceScore(strategyScores)
    );
    const action = this.normalizeAction(parsed.action, strategyScores, convergenceScore);
    const confidence = this.normalizeConfidence(parsed.confidence, strategyScores, convergenceScore);
    const approved = this.normalizeApproved(parsed.approved, action, confidence);
    const contradictions = Array.isArray(parsed.contradictions)
      ? parsed.contradictions.slice(0, 3).map((item) => String(item))
      : [];

    const reason = this.normalizeTradeReviewReason(parsed.reason, {
      action,
      source: parsed
    });

    return {
      approved,
      confidence,
      reason,
      primaryStrategy,
      convergenceScore,
      action,
      strategyScores,
      contradictions,
      executionProfile: this.normalizeExecutionProfile(parsed.executionProfile, primaryStrategy)
    };
  }

  buildEmptyStrategyScores() {
    return {
      RUNNER_HUNTER: 0,
      SNIPER: 0,
      SCALPER: 0,
      MIGRATION_HUNTER: 0,
      WALLET_FLOW: 0
    };
  }

  normalizeStrategyScores(raw = {}) {
    const fallback = this.buildEmptyStrategyScores();
    for (const key of Object.keys(fallback)) {
      fallback[key] = this.normalizeUnitInterval(this.readStrategyScore(raw, key), 0);
    }
    return fallback;
  }

  readStrategyScore(raw = {}, canonicalKey) {
    if (!raw || typeof raw !== 'object') {
      return undefined;
    }

    const normalizedTarget = this.normalizeStrategyKey(canonicalKey);
    for (const [key, value] of Object.entries(raw)) {
      if (this.normalizeStrategyKey(key) === normalizedTarget) {
        return value;
      }
    }

    return undefined;
  }

  normalizeStrategyKey(value) {
    return String(value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toUpperCase();
  }

  normalizePrimaryStrategy(raw, strategyScores) {
    const allowed = Object.keys(this.buildEmptyStrategyScores());
    const normalized = this.normalizeStrategyKey(raw);
    if (allowed.includes(normalized)) {
      return normalized;
    }

    return allowed.reduce((bestKey, nextKey) => {
      return strategyScores[nextKey] > strategyScores[bestKey] ? nextKey : bestKey;
    }, allowed[0]);
  }

  calculateConvergenceScore(strategyScores) {
    const ordered = Object.values(strategyScores).sort((a, b) => b - a);
    const top = ordered[0] || 0;
    const support = ordered[1] || 0;
    return Number(Math.min(1, (top * 0.7) + (support * 0.3)).toFixed(4));
  }

  normalizeAction(raw, strategyScores, convergenceScore) {
    const normalized = String(raw || '').trim().toUpperCase();
    if (['ENTER', 'WATCH', 'REJECT'].includes(normalized)) {
      return normalized;
    }
    if (['BUY', 'APPROVE', 'APPROVED', 'YES', 'TRADE'].includes(normalized)) {
      return 'ENTER';
    }
    if (['HOLD', 'CAUTION', 'WAIT', 'MONITOR'].includes(normalized)) {
      return 'WATCH';
    }
    if (['PASS', 'SKIP', 'NO', 'NO_TRADE', 'VETO', 'DENY', 'DENIED'].includes(normalized)) {
      return 'REJECT';
    }

    const top = Math.max(...Object.values(strategyScores));
    if (top >= 0.75 && convergenceScore >= 0.65) {
      return 'ENTER';
    }
    if (top >= 0.55) {
      return 'WATCH';
    }
    return 'REJECT';
  }

  normalizeConfidence(raw, strategyScores, convergenceScore) {
    if (raw !== undefined && raw !== null && Number.isFinite(Number(raw))) {
      const normalized = Number(raw);
      if (normalized <= 1) {
        return Number((normalized * 100).toFixed(2));
      }
      return Number(Math.max(0, Math.min(normalized, 100)).toFixed(2));
    }

    const top = Math.max(...Object.values(strategyScores));
    return Number(Math.max(0, Math.min(((top * 0.7) + (convergenceScore * 0.3)) * 100, 100)).toFixed(2));
  }

  normalizeApproved(raw, action, confidence) {
    if (typeof raw === 'boolean') {
      return raw;
    }

    return action === 'ENTER' && confidence >= 60;
  }

  normalizeTradeReviewReason(raw, context = {}) {
    const action = context.action || 'WATCH';
    const parsed = String(raw || '').trim();
    if (!parsed) {
      return action === 'ENTER' ? 'AI_REVIEW_COMPLETE' : `AI_${action}`;
    }

    const lowered = parsed.toLowerCase();
    const invalidFallbackReasons = [
      'ai_review_complete',
      'deterministic volume/liquidity/risk filter passed',
      'return exactly this shape',
      'candidate json:',
      'analyze this solana memecoin trade candidate'
    ];
    const structuredReasonPrefixes = [
      'AI_',
      'QUOTE_',
      'PUMP_',
      'LOW_',
      'RUNNER_',
      'INSUFFICIENT_',
      'MAX_',
      'TOKEN_',
      'SESSION_',
      'STOP_',
      'TAKE_',
      'TIME_',
      'SIGNAL_',
      'MANUAL_PARSE_FALLBACK:',
      'OLLAMA_'
    ];
    const looksStructuredReason =
      structuredReasonPrefixes.some((prefix) => parsed.startsWith(prefix))
      || /^[A-Z0-9_:-]+$/.test(parsed);

    if (invalidFallbackReasons.some((value) => lowered.includes(value))) {
      return action === 'ENTER'
        ? 'AI_REVIEW_COMPLETE'
        : `MANUAL_PARSE_FALLBACK:${action}`;
    }

    if (!looksStructuredReason) {
      return action === 'ENTER'
        ? 'AI_REVIEW_COMPLETE'
        : context.source?.manualFallback
          ? `MANUAL_PARSE_FALLBACK:${action}`
          : `AI_${action}`;
    }

    return parsed;
  }

  normalizeExecutionProfile(raw = {}, primaryStrategy) {
    const fallback = this.executionProfileForStrategy(primaryStrategy);

    return {
      entryUrgency: ['low', 'medium', 'high'].includes(raw.entryUrgency) ? raw.entryUrgency : fallback.entryUrgency,
      expectedHold: ['scalp', 'short', 'short_to_medium', 'medium'].includes(raw.expectedHold) ? raw.expectedHold : fallback.expectedHold,
      exitStyle: ['fixed', 'tight_invalidation', 'trailing_runner', 'migration_hold', 'flow_follow'].includes(raw.exitStyle) ? raw.exitStyle : fallback.exitStyle
    };
  }

  executionProfileForStrategy(primaryStrategy) {
    switch (primaryStrategy) {
      case 'RUNNER_HUNTER':
        return { entryUrgency: 'high', expectedHold: 'short_to_medium', exitStyle: 'trailing_runner' };
      case 'SNIPER':
        return { entryUrgency: 'high', expectedHold: 'short', exitStyle: 'tight_invalidation' };
      case 'SCALPER':
        return { entryUrgency: 'medium', expectedHold: 'scalp', exitStyle: 'fixed' };
      case 'MIGRATION_HUNTER':
        return { entryUrgency: 'medium', expectedHold: 'medium', exitStyle: 'migration_hold' };
      case 'WALLET_FLOW':
        return { entryUrgency: 'medium', expectedHold: 'short_to_medium', exitStyle: 'flow_follow' };
      default:
        return this.buildDefaultExecutionProfile();
    }
  }

  buildDefaultExecutionProfile() {
    return { entryUrgency: 'low', expectedHold: 'short', exitStyle: 'fixed' };
  }

  normalizeUnitInterval(value, fallback = 0) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    if (parsed > 1) {
      return Number(Math.max(0, Math.min(parsed / 100, 1)).toFixed(4));
    }

    return Number(Math.max(0, Math.min(parsed, 1)).toFixed(4));
  }

  normalizeOptionalNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  buildMarketAnalysisPrompt(marketData, tokenData, currentPositions) {
    return `You are an expert Solana memecoin trading AI. Analyze the following market data and provide trading recommendations.

Current Market Conditions:
- SOL Price: $${marketData.solPrice}
- Market Sentiment: ${marketData.sentiment}
- Network Congestion: ${marketData.congestionLevel}

Token Analysis:
${tokenData.map(token => `- ${token.mintAddress}: Price: $${token.price}, Volume: ${token.volume} SOL, Liquidity: ${token.liquidity} SOL, Risk Score: ${token.riskScore}`).join('\n')}

Current Positions:
${currentPositions.map(pos => `- ${pos.token}: ${pos.amount} tokens, Entry: $${pos.entryPrice}, Current: $${pos.currentPrice}, PnL: ${((pos.currentPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2)}%`).join('\n')}

Risk Management Rules:
- Max position size: ${marketData.maxPositionSize} SOL
- Stop loss: ${marketData.stopLossPercent * 100}%
- Take profit: ${marketData.takeProfitPercent * 100}%
- Max daily loss: ${marketData.maxDailyLoss} SOL

Please provide:
1. Market sentiment analysis (bullish/bearish/neutral)
2. Recommended actions (buy/sell/hold) for each token
3. Risk assessment
4. Confidence level (0-100%)
5. Specific entry/exit points if applicable

Format your response as JSON with the following structure:
{
  "sentiment": "bullish/bearish/neutral",
  "confidence": 0-100,
  "actions": [
    {
      "token": "mint_address",
      "action": "buy/sell/hold",
      "amount": "amount_in_sol",
      "entryPrice": "target_entry_price",
      "stopLoss": "stop_loss_price",
      "takeProfit": "take_profit_price",
      "reasoning": "explanation"
    }
  ],
  "riskAssessment": {
    "overall": "low/medium/high",
    "details": "explanation"
  }
}`;
  }

  async sendMessage(prompt, systemPrompt = null, overrides = {}) {
    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    try {
      const response = await axios.post(this.apiEndpoint, {
        model: this.model,
        messages,
        stream: false,
        think: false,
        keep_alive: this.config.ollamaKeepAlive,
        options: {
          temperature: 0.1,
          num_predict: overrides.numPredict || 80
        }
      }, {
        timeout: overrides.timeout || this.config.aiTimeoutMs,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const content = response.data?.message?.content;
      if (!content) {
        throw new Error('Ollama response did not include message content');
      }

      this.conversationHistory.push({
        role: 'user',
        content: prompt
      });
      
      this.conversationHistory.push({
        role: 'assistant',
        content
      });

      return content;
    } catch (error) {
      if (error.response?.data) {
        this.logger.error('Ollama API error', {
          status: error.response.status,
          data: error.response.data
        });
      }
      throw error;
    }
  }

  parseAnalysisResponse(response) {
    try {
      const cleaned = String(response || '').trim();
      const parsedCandidates = this.parseJsonCandidates(cleaned);

      if (parsedCandidates.length > 0) {
        return parsedCandidates[0];
      }

      return this.parseManualResponse(cleaned);
    } catch (error) {
      this.logger.error('Failed to parse AI response', error.message);
      throw new Error('Invalid AI response format');
    }
  }

  parseTradeReviewResponse(response) {
    const cleaned = String(response || '').trim();
    const parsedCandidates = this.parseJsonCandidates(cleaned);
    const reviewCandidate = parsedCandidates.find((candidate) => this.looksLikeTradeReviewResponse(candidate));

    if (reviewCandidate) {
      return reviewCandidate;
    }

    if (parsedCandidates.length > 0) {
      throw new Error('No trade review JSON object found in AI response');
    }

    return this.parseManualResponse(cleaned);
  }

  parseJsonCandidates(response) {
    const jsonCandidates = this.extractJsonCandidates(response);
    const parsedCandidates = [];

    for (const candidate of jsonCandidates) {
      const parsed = this.tryParseJsonCandidate(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedCandidates.push(parsed);
      }
    }

    return parsedCandidates;
  }

  looksLikeTradeReviewResponse(candidate) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return false;
    }

    if (
      candidate.action !== undefined ||
      candidate.approved !== undefined ||
      candidate.strategyScores !== undefined
    ) {
      return true;
    }

    const reviewSignals = [
      'confidence',
      'primaryStrategy',
      'convergenceScore',
      'reason',
      'contradictions',
      'executionProfile'
    ];
    const matchCount = reviewSignals.reduce((count, key) => (
      candidate[key] !== undefined ? count + 1 : count
    ), 0);

    return matchCount >= 3;
  }

  extractJsonCandidates(response) {
    const candidates = [];
    const fenced = response.replace(/```json\s*([\s\S]*?)```/gi, '$1').replace(/```([\s\S]*?)```/g, '$1');

    for (let start = fenced.indexOf('{'); start !== -1; start = fenced.indexOf('{', start + 1)) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let index = start; index < fenced.length; index += 1) {
        const char = fenced[index];

        if (escaped) {
          escaped = false;
          continue;
        }

        if (char === '\\') {
          escaped = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) {
          continue;
        }

        if (char === '{') {
          depth += 1;
        } else if (char === '}') {
          depth -= 1;
          if (depth === 0) {
            candidates.push(fenced.slice(start, index + 1));
            start = index;
            break;
          }
        }
      }

      if (depth > 0) {
        candidates.push(fenced.slice(start));
        break;
      }
    }

    return candidates;
  }

  tryParseJsonCandidate(candidate) {
    const attempts = [
      candidate,
      candidate.replace(/,\s*([}\]])/g, '$1'),
      // JSON forbids these raw control characters; sanitize malformed model output.
      // eslint-disable-next-line no-control-regex
      candidate.replace(/[\u0000-\u0019]+/g, ' ')
    ];

    for (const attempt of attempts) {
      try {
        return JSON.parse(attempt);
      } catch (error) {
        // Try next candidate shape.
      }
    }

    return null;
  }

  parseManualResponse(response) {
    // Treat non-JSON output as low-confidence fallback context, not as a strong veto by default.
    const normalizedResponse = String(response || '').trim();
    const responseWindow = normalizedResponse
      .slice(0, 600)
      .replace(/Candidate JSON:[\s\S]*$/i, '')
      .replace(/Return exactly this shape:[\s\S]*$/i, '')
      .trim();
    const sentimentMatch = responseWindow.match(/sentiment:\s*(bullish|bearish|neutral)/i);
    const confidenceMatch = responseWindow.match(/"?confidence"?\s*[:=]\s*"?(\d+(?:\.\d+)?)%?"?/i);
    const approvedMatch = responseWindow.match(/"?approved"?\s*[:=]\s*"?\b(true|false|yes|no|approve|approved|reject|rejected|veto)\b"?/i);
    const actionMatch = responseWindow.match(/"?action"?\s*[:=]\s*"?\b(enter|watch|reject|approved|approve|veto|caution)\b"?/i)
      || responseWindow.match(/\b(enter|watch|reject|approved|approve|veto|caution)\b/i);
    const reasonMatch = responseWindow.match(/"?reason"?\s*[:=]\s*"([^"]+)"/i)
      || responseWindow.match(/reason\s*[:=]\s*([^\n\r}]+)/i);
    const strategyMatch = responseWindow.match(/\b(RUNNER_HUNTER|SNIPER|SCALPER|MIGRATION_HUNTER|WALLET_FLOW)\b/i);
    const approvedRaw = approvedMatch?.[1]?.toLowerCase();
    const approved = ['true', 'yes', 'approve', 'approved'].includes(approvedRaw);
    const actionRaw = actionMatch?.[1]?.toLowerCase() || '';

    let action = 'WATCH';
    if (['reject', 'veto'].includes(actionRaw) || approvedRaw === 'false' || approvedRaw === 'no') {
      action = 'REJECT';
    } else if (['enter', 'approved', 'approve'].includes(actionRaw) || approved) {
      action = 'WATCH';
    } else if (['watch', 'caution'].includes(actionRaw)) {
      action = 'WATCH';
    }

    const fallbackConfidence = confidenceMatch
      ? Number(confidenceMatch[1])
      : action === 'REJECT'
        ? 30
        : 25;
    const rawReason = reasonMatch?.[1]?.trim();
    const reason = this.normalizeTradeReviewReason(rawReason, {
      action,
      source: { manualFallback: true }
    });

    return {
      sentiment: sentimentMatch ? sentimentMatch[1].toLowerCase() : 'neutral',
      confidence: fallbackConfidence,
      approved: false,
      reason,
      primaryStrategy: strategyMatch?.[1]?.toUpperCase() || 'NONE',
      convergenceScore: action === 'REJECT' ? 0.2 : 0.35,
      action,
      strategyScores: this.buildEmptyStrategyScores(),
      contradictions: ['Fallback parse used; AI response was not valid JSON'],
      executionProfile: this.buildDefaultExecutionProfile(),
      actions: [],
      riskAssessment: {
        overall: action === 'REJECT' ? 'medium' : 'low',
        details: response.substring(0, 200) + (response.length > 200 ? '...' : '')
      }
    };
  }

  async analyzeRisk(tokenData, marketConditions) {
    const prompt = `Analyze the risk of trading this token:

Token: ${tokenData.mintAddress}
Price: $${tokenData.price}
Volume: ${tokenData.volume} SOL
Liquidity: ${tokenData.liquidity} SOL
Risk Score: ${tokenData.riskScore}

Market Conditions:
- SOL Price: $${marketConditions.solPrice}
- Network Congestion: ${marketConditions.congestionLevel}
- Overall Sentiment: ${marketConditions.sentiment}

Provide a risk assessment on a scale of 1-10 (1=lowest risk, 10=highest risk) and detailed reasoning.`;

    try {
      const response = await this.sendMessage(prompt);
      return this.parseRiskResponse(response);
    } catch (error) {
      this.logger.error('Risk analysis failed', error.message);
      throw error;
    }
  }

  parseRiskResponse(response) {
    const scoreMatch = response.match(/(\d+)\s*\/\s*10/);
    const score = scoreMatch ? parseInt(scoreMatch[1]) : 5;
    
    return {
      score,
      level: score <= 3 ? 'low' : score <= 7 ? 'medium' : 'high',
      reasoning: response
    };
  }

  async generateTradingStrategy(marketData, tokenData) {
    const prompt = `Based on the current market conditions and token analysis, generate a comprehensive trading strategy.

Market Data:
${JSON.stringify(marketData, null, 2)}

Token Data:
${JSON.stringify(tokenData, null, 2)}

Provide:
1. Overall strategy (aggressive/conservative/balanced)
2. Position sizing recommendations
3. Entry and exit criteria
4. Risk management rules
5. Specific tokens to focus on
6. Time horizon recommendations`;

    try {
      const response = await this.sendMessage(prompt);
      return {
        strategy: response,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Strategy generation failed', error.message);
      throw error;
    }
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  getHistory() {
    return this.conversationHistory;
  }
}

module.exports = AIAgent;
