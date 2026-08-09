const fs = require('fs');
const path = require('path');
const AsyncJsonlWriter = require('./async-jsonl-writer');

class LaunchIntelStore {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.enabled = config.launchIntelEnabled !== false;
    this.source = config.launchIntelSource || 'pumpportal';
    this.latestFilePath = config.launchIntelLatestFilePath;
    this.historyFilePath = config.launchIntelHistoryFilePath;
    this.deployerIndexFilePath = config.launchIntelDeployerIndexFilePath;
    this.walletIndexFilePath = config.launchIntelWalletIndexFilePath;
    this.runtimeFlushEnabled = config.launchIntelRuntimeFlushEnabled === true;
    this.walletIntelFilePath = config.walletIntelFilePath;
    this.kolscanLeaderboardFilePath = config.kolscanLeaderboardFilePath;
    this.manualKolWalletFilePath = config.manualKolWalletFilePath;
    this.shadowWalletFilePath = config.shadowWalletFilePath;
    this.flushIntervalMs = config.launchIntelFlushIntervalMs;
    this.indexFlushIntervalMs = config.launchIntelIndexFlushIntervalMs;
    this.maxTrackedTokens = config.launchIntelMaxTrackedTokens;
    this.maxEarlyBuys = config.launchIntelMaxEarlyBuys;
    this.sniperWindowMs = config.launchIntelSniperWindowMs;
    this.bundlerWindowMs = config.launchIntelBundlerWindowMs;
    this.bundlerMinWallets = config.launchIntelBundlerMinWallets;

    this.records = new Map();
    this.deployerIndex = new Map();
    this.walletIndex = new Map();
    this.kolWalletProfiles = new Map();
    this.lastFlushAt = 0;
    this.lastIndexFlushAt = 0;
    this.dirty = false;
    this.isRehydrating = false;
    this.stateLoadStats = {
      source: this.source,
      loadedFiles: 0,
      skippedSourceMismatches: 0,
      skippedLegacySourceLessFiles: 0
    };

    if (!this.enabled) {
      return;
    }

    fs.mkdirSync(path.dirname(this.latestFilePath), { recursive: true });
    fs.mkdirSync(path.dirname(this.historyFilePath), { recursive: true });
    fs.mkdirSync(path.dirname(this.deployerIndexFilePath), { recursive: true });
    fs.mkdirSync(path.dirname(this.walletIndexFilePath), { recursive: true });
    this.historyWriter = new AsyncJsonlWriter(this.historyFilePath, this.logger);
    this.loadKolWalletProfiles();
    this.loadExistingState();
  }

  readCompatibleSnapshot(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const snapshotSource = String(parsed?.source || '').trim().toLowerCase();
    const expectedSource = String(this.source || '').trim().toLowerCase();

    if (!snapshotSource && expectedSource === 'helius') {
      this.stateLoadStats.skippedLegacySourceLessFiles += 1;
      this.logger.warn(`Skipped source-less launch intel snapshot while Helius is active: ${path.basename(filePath)}`);
      return null;
    }
    if (snapshotSource && snapshotSource !== expectedSource) {
      this.stateLoadStats.skippedSourceMismatches += 1;
      this.logger.warn(`Skipped launch intel snapshot for ${snapshotSource}; active source is ${expectedSource}`);
      return null;
    }

    this.stateLoadStats.loadedFiles += 1;
    return parsed;
  }

  loadExistingState() {
    try {
      this.isRehydrating = true;
      let loadedWalletIndex = false;
      const latestSnapshot = this.readCompatibleSnapshot(this.latestFilePath);
      if (latestSnapshot) {
        const parsed = latestSnapshot;
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        for (const item of items) {
          if (!item?.mint) {
            continue;
          }

          this.records.set(item.mint, {
            mint: item.mint,
            symbol: item.symbol || null,
            name: item.name || null,
            source: item.source || 'pumpportal',
            createdAt: item.createdAt || null,
            firstTradeAt: item.firstTradeAt || null,
            migratedAt: item.migratedAt || null,
            firstObservedSlot: item.firstObservedSlot || null,
            tradeCount: Number(item.tradeCount || 0),
            buys: Number(item.buys || 0),
            sells: Number(item.sells || 0),
            uniqueBuyers: Array.isArray(item.uniqueBuyerSamples) ? item.uniqueBuyerSamples : [],
            earlyBuys: Array.isArray(item.earlyBuys) ? item.earlyBuys.slice(0, this.maxEarlyBuys) : [],
            slotBuyCounts: item.slotBuyCounts && typeof item.slotBuyCounts === 'object' ? item.slotBuyCounts : {},
            latestLiquiditySol: Number(item.latestLiquiditySol || 0),
            latestMarketCapSol: Number(item.latestMarketCapSol || 0),
            lastTradeAt: item.lastTradeAt || null,
            deployerWallet: item.deployerWallet || item.heuristics?.deployer?.wallet || null,
            deployerActivity: Array.isArray(item.deployerActivity) ? item.deployerActivity : [],
            externalSightings: {
              mentionCount: Number(item.externalSightings?.mentionCount || 0),
              firstSeenAt: item.externalSightings?.firstSeenAt || null,
              lastSeenAt: item.externalSightings?.lastSeenAt || null,
              chats: Array.isArray(item.externalSightings?.chats) ? item.externalSightings.chats : [],
              snippets: Array.isArray(item.externalSightings?.snippets) ? item.externalSightings.snippets : [],
              refs: Array.isArray(item.externalSightings?.refs) ? item.externalSightings.refs : []
            },
            poolState: item.poolState && typeof item.poolState === 'object'
              ? item.poolState
              : null,
            preMigrationState: item.preMigrationState && typeof item.preMigrationState === 'object'
              ? item.preMigrationState
              : null,
            summary: null,
            heuristicEvents: Array.isArray(item.heuristicEvents) ? item.heuristicEvents : []
          });
        }
      }

      const deployerSnapshot = this.readCompatibleSnapshot(this.deployerIndexFilePath);
      if (deployerSnapshot) {
        const parsedIndex = deployerSnapshot;
        const items = Array.isArray(parsedIndex?.items) ? parsedIndex.items : [];
        for (const item of items) {
          if (!item?.wallet) {
            continue;
          }

          this.deployerIndex.set(item.wallet, {
            wallet: item.wallet,
            firstSeen: item.firstSeen || null,
            lastSeen: item.lastSeen || null,
            totalTokens: Number(item.totalTokens || 0),
            launches: Array.isArray(item.launches) ? item.launches : []
          });
        }
      }

      const walletSnapshot = this.readCompatibleSnapshot(this.walletIndexFilePath);
      if (walletSnapshot) {
        const parsedIndex = walletSnapshot;
        const items = Array.isArray(parsedIndex?.items) ? parsedIndex.items : [];
        for (const item of items) {
          if (!item?.wallet) {
            continue;
          }

          this.walletIndex.set(item.wallet, {
            wallet: item.wallet,
            firstSeen: item.firstSeen || null,
            lastSeen: item.lastSeen || null,
            totalLaunches: Number(item.totalLaunches || 0),
            totalBuyCount: Number(item.totalBuyCount || 0),
            totalVolumeSol: Number(item.totalVolumeSol || 0),
            launches: Array.isArray(item.launches) ? item.launches : []
          });
        }
        loadedWalletIndex = this.walletIndex.size > 0;
      }

      for (const record of this.records.values()) {
        this.updateDeployerIndex(record);
      }

      if (!loadedWalletIndex) {
        for (const record of this.records.values()) {
          for (const buy of record.earlyBuys || []) {
            this.updateWalletIndex(record, buy);
          }
        }
      }

      for (const record of this.records.values()) {
        this.updateSummary(record);
      }
    } catch (error) {
      this.logger.warn('Failed to load launch intel state', error.message);
    } finally {
      this.isRehydrating = false;
    }
  }

  loadKolWalletProfiles() {
    const nextProfiles = new Map();
    const upsertProfile = (wallet, patch = {}) => {
      if (!wallet) {
        return;
      }

      const existing = nextProfiles.get(wallet) || {
        wallet,
        name: null,
        rank: null,
        twitter: null,
        telegram: null,
        source: null,
        trustTier: null,
        profile: null,
        score: null,
        shadowOnly: false,
        flags: []
      };

      const next = {
        ...existing,
        ...patch,
        wallet,
        name: patch.name || existing.name || null,
        rank: patch.rank ?? existing.rank ?? null,
        twitter: patch.twitter || existing.twitter || null,
        telegram: patch.telegram || existing.telegram || null,
        source: patch.source || existing.source || null,
        trustTier: patch.trustTier || existing.trustTier || null,
        profile: patch.profile || existing.profile || null,
        score: patch.score ?? existing.score ?? null,
        shadowOnly: patch.shadowOnly === true || existing.shadowOnly === true,
        flags: Array.from(new Set([
          ...(Array.isArray(existing.flags) ? existing.flags : []),
          ...(Array.isArray(patch.flags) ? patch.flags : [])
        ])).slice(0, 6)
      };

      nextProfiles.set(wallet, next);
    };

    try {
      if (this.kolscanLeaderboardFilePath && fs.existsSync(this.kolscanLeaderboardFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.kolscanLeaderboardFilePath, 'utf8'));
        for (const item of parsed.wallets || []) {
          const wallet = item?.walletAddress;
          if (!wallet) {
            continue;
          }

          upsertProfile(wallet, {
            name: item.name || null,
            rank: Number(item.rank || 0) || null,
            twitter: item.twitter || null,
            telegram: item.telegram || null,
            source: item.source || 'kolscan_leaderboard'
          });
        }
      }

      if (this.manualKolWalletFilePath && fs.existsSync(this.manualKolWalletFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.manualKolWalletFilePath, 'utf8'));
        for (const item of parsed.wallets || []) {
          const wallet = item?.walletAddress || item?.wallet;
          if (!wallet) {
            continue;
          }

          upsertProfile(wallet, {
            name: item.name || null,
            rank: Number(item.rank || 0) || null,
            twitter: item.twitter || null,
            telegram: item.telegram || null,
            source: item.source || 'manual_kol_research',
            trustTier: item.trustTier || null,
            profile: item.profile || null,
            score: Number(item.score || 0) || null,
            flags: Array.isArray(item.flags) ? item.flags : []
          });
        }
      }

      if (this.walletIntelFilePath && fs.existsSync(this.walletIntelFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.walletIntelFilePath, 'utf8'));
        for (const item of parsed.topWallets || []) {
          const wallet = item?.walletAddress;
          if (!wallet) {
            continue;
          }

          upsertProfile(wallet, {
            name: item.name || null,
            rank: Number(item.rank || 0) || null,
            source: item.source || 'wallet_intel',
            trustTier: item.behavior?.trustTier || null,
            profile: item.behavior?.behaviorProfile || item.profile || null,
            score: Number(item.score || 0) || null,
            flags: Array.isArray(item.behavior?.flags)
              ? item.behavior.flags.slice(0, 6)
              : []
          });
        }
      }

      if (this.shadowWalletFilePath && fs.existsSync(this.shadowWalletFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.shadowWalletFilePath, 'utf8'));
        for (const item of parsed.wallets || []) {
          const wallet = item?.walletAddress || item?.wallet;
          if (!wallet) {
            continue;
          }

          upsertProfile(wallet, {
            name: item.name || null,
            source: item.source || 'shadow_wallet_review',
            trustTier: null,
            profile: item.profile || 'shadow_untracked_review',
            score: Number(item.score || 0) || null,
            shadowOnly: true,
            flags: Array.from(new Set([
              'SHADOW_ONLY',
              ...(Array.isArray(item.flags) ? item.flags : [])
            ])).slice(0, 8)
          });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to load KOL wallet profiles', error.message);
      return;
    }

    this.kolWalletProfiles = nextProfiles;
  }

  getKolWalletProfile(wallet) {
    if (!wallet) {
      return null;
    }
    return this.kolWalletProfiles.get(wallet) || null;
  }

  buildKolWalletSummary(wallet, extras = {}) {
    const profile = this.getKolWalletProfile(wallet);
    if (!profile) {
      return null;
    }

    return {
      wallet,
      name: profile.name || null,
      rank: profile.rank || null,
      trustTier: profile.trustTier || null,
      profile: profile.profile || null,
      score: profile.score || null,
      source: profile.source || null,
      shadowOnly: profile.shadowOnly === true,
      flags: Array.isArray(profile.flags) ? profile.flags.slice(0, 5) : [],
      ...extras
    };
  }

  ensureRecord(mint, seed = {}) {
    const existing = this.records.get(mint);
    if (existing) {
      return existing;
    }

    const record = {
      mint,
      symbol: seed.symbol || null,
      name: seed.name || null,
      source: seed.source || 'pumpportal',
      createdAt: seed.createdAt || new Date().toISOString(),
      firstTradeAt: null,
      migratedAt: null,
      firstObservedSlot: null,
      tradeCount: 0,
      buys: 0,
      sells: 0,
      uniqueBuyers: [],
      earlyBuys: [],
      slotBuyCounts: {},
      latestLiquiditySol: 0,
      latestMarketCapSol: 0,
      lastTradeAt: null,
      deployerWallet: seed.deployerWallet || null,
      deployerActivity: [],
      externalSightings: {
        mentionCount: 0,
        firstSeenAt: null,
        lastSeenAt: null,
        chats: [],
        snippets: [],
        refs: []
      },
      poolState: null,
      preMigrationState: null,
      summary: null,
      heuristicEvents: []
    };

    this.records.set(mint, record);
    return record;
  }

  updateDeployerIndex(record) {
    if (!record?.deployerWallet || !record?.mint) {
      return;
    }

    const firstSeen = record.createdAt || new Date().toISOString();
    const existing = this.deployerIndex.get(record.deployerWallet) || {
      wallet: record.deployerWallet,
      firstSeen,
      lastSeen: firstSeen,
      totalTokens: 0,
      launches: []
    };

    if (!existing.launches.some((launch) => launch.mint === record.mint)) {
      existing.launches.push({
        mint: record.mint,
        symbol: record.symbol || null,
        name: record.name || null,
        createdAt: firstSeen
      });
      existing.totalTokens = existing.launches.length;
    }

    existing.firstSeen = existing.firstSeen || firstSeen;
    existing.lastSeen = record.lastTradeAt || record.createdAt || existing.lastSeen || firstSeen;
    this.deployerIndex.set(record.deployerWallet, existing);
  }

  getDeployerSummary(wallet) {
    if (!wallet) {
      return null;
    }

    const entry = this.deployerIndex.get(wallet);
    if (!entry) {
      return null;
    }

    return {
      wallet: entry.wallet,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      totalTokens: entry.totalTokens,
      recentLaunches: entry.launches
        .slice()
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .slice(0, 8)
    };
  }

  updateWalletIndex(record, buy) {
    const wallet = buy?.wallet;
    if (!wallet || !record?.mint) {
      return;
    }

    const seenAt = buy.timestamp || record.firstTradeAt || record.createdAt || new Date().toISOString();
    const volumeSol = Number(buy.volumeSol || 0);
    const existing = this.walletIndex.get(wallet) || {
      wallet,
      firstSeen: seenAt,
      lastSeen: seenAt,
      totalLaunches: 0,
      totalBuyCount: 0,
      totalVolumeSol: 0,
      launches: []
    };

    let launch = existing.launches.find((entry) => entry.mint === record.mint);
    if (!launch) {
      launch = {
        mint: record.mint,
        symbol: record.symbol || null,
        name: record.name || null,
        firstSeen: seenAt,
        lastSeen: seenAt,
        buyCount: 0,
        totalVolumeSol: 0
      };
      existing.launches.push(launch);
      existing.totalLaunches = existing.launches.length;
    }

    launch.buyCount += 1;
    launch.totalVolumeSol += volumeSol;
    launch.lastSeen = seenAt;

    existing.firstSeen = existing.firstSeen || seenAt;
    existing.lastSeen = seenAt;
    existing.totalBuyCount += 1;
    existing.totalVolumeSol += volumeSol;
    this.walletIndex.set(wallet, existing);
  }

  getWalletSummary(wallet) {
    if (!wallet) {
      return null;
    }

    const entry = this.walletIndex.get(wallet);
    if (!entry) {
      return null;
    }

    return {
      wallet: entry.wallet,
      firstSeen: entry.firstSeen,
      lastSeen: entry.lastSeen,
      totalLaunches: entry.totalLaunches,
      totalBuyCount: entry.totalBuyCount,
      totalVolumeSol: entry.totalVolumeSol,
      recentLaunches: entry.launches
        .slice()
        .sort((a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime())
        .slice(0, 8)
    };
  }

  registerNewToken(event) {
    if (!this.enabled) {
      return null;
    }

    const mint = event?.mint || event?.token || event?.mintAddress;
    if (!mint) {
      return null;
    }

    const record = this.ensureRecord(mint, {
      symbol: event.symbol,
      name: event.name,
      source: event.source || 'pumpportal_create',
      createdAt: new Date().toISOString(),
      deployerWallet: event.deployerWallet || event.creator || event.author || event.founder || event.traderPublicKey || event.wallet || event.account || null
    });

    record.symbol = event.symbol || record.symbol;
    record.name = event.name || record.name;
    record.source = event.source || record.source;
    record.createdAt = record.createdAt || new Date().toISOString();
    record.deployerWallet = record.deployerWallet
      || event.deployerWallet
      || event.creator
      || event.author
      || event.founder
      || event.traderPublicKey
      || event.wallet
      || event.account
      || null;
    this.updateDeployerIndex(record);

    this.updateSummary(record);
    this.appendHistory('new_token', {
      mint,
      symbol: record.symbol,
      name: record.name,
      source: record.source,
      createdAt: record.createdAt,
      deployerWallet: record.deployerWallet
    });
    this.compactIfNeeded();
    this.markDirty();
    return record.summary;
  }

  registerTrade(event) {
    if (!this.enabled) {
      return null;
    }

    const mint = event?.mint || event?.token || event?.mintAddress;
    if (!mint) {
      return null;
    }

    const nowIso = new Date().toISOString();
    const record = this.ensureRecord(mint, {
      symbol: event.symbol,
      name: event.name,
      source: event.source || 'pumpportal_trade',
      createdAt: nowIso
    });

    record.symbol = event.symbol || record.symbol;
    record.name = event.name || record.name;
    record.source = event.source || record.source;
    record.lastTradeAt = nowIso;
    record.tradeCount += 1;

    const side = event.txType === 'sell' ? 'sell' : 'buy';
    if (side === 'buy') {
      record.buys += 1;
    } else {
      record.sells += 1;
    }

    const tradeAtMs = Number(event.timestamp || event.blockTime || Date.now());
    const tradeAtIso = new Date(tradeAtMs).toISOString();
    record.firstTradeAt = record.firstTradeAt || tradeAtIso;

    const slot = event.slot ?? event.blockSlot ?? event.slotNumber ?? null;
    if (slot !== null && slot !== undefined) {
      record.firstObservedSlot = record.firstObservedSlot || Number(slot);
    }

    const trader = event.traderPublicKey || event.wallet || event.account || null;
    const signature = event.signature || event.txSignature || event.sig || null;
    const volumeSol = Number(event.solAmount || event.vSolInBondingCurve || 0);

    if (trader && record.deployerWallet && trader === record.deployerWallet) {
      if (record.deployerActivity.length < this.maxEarlyBuys) {
        record.deployerActivity.push({
          wallet: trader,
          timestamp: tradeAtIso,
          timestampMs: tradeAtMs,
          signature,
          side,
          volumeSol
        });
      }
    }

    if (side === 'buy' && trader) {
      if (!record.uniqueBuyers.includes(trader)) {
        record.uniqueBuyers.push(trader);
      }

      if (record.earlyBuys.length < this.maxEarlyBuys) {
        const earlyBuy = {
          wallet: trader,
          timestamp: tradeAtIso,
          timestampMs: tradeAtMs,
          slot: slot !== null && slot !== undefined ? Number(slot) : null,
          signature,
          volumeSol
        };
        record.earlyBuys.push(earlyBuy);
        this.updateWalletIndex(record, earlyBuy);
      }

      if (slot !== null && slot !== undefined) {
        const key = String(slot);
        const slotState = record.slotBuyCounts[key] || { wallets: [] };
        if (!slotState.wallets.includes(trader)) {
          slotState.wallets.push(trader);
        }
        record.slotBuyCounts[key] = slotState;
      }
    }

    record.latestLiquiditySol = Number(event.vSolInBondingCurve || record.latestLiquiditySol || 0);
    record.latestMarketCapSol = Number(event.marketCapSol || event.marketCap || record.latestMarketCapSol || 0);
    this.updateDeployerIndex(record);

    this.updateSummary(record);
    this.compactIfNeeded();
    this.markDirty();
    return record.summary;
  }

  registerMigration(event) {
    if (!this.enabled) {
      return null;
    }

    const mint = event?.mint || event?.token || event?.mintAddress;
    if (!mint) {
      return null;
    }

    const record = this.ensureRecord(mint, {
      symbol: event.symbol,
      name: event.name,
      source: event.source || 'pumpportal_migration',
      createdAt: new Date().toISOString()
    });

    record.migratedAt = new Date().toISOString();
    this.updateSummary(record);
    this.appendHistory('migration', {
      mint,
      migratedAt: record.migratedAt
    });
    this.markDirty();
    return record.summary;
  }

  registerExternalSighting(sighting) {
    if (!this.enabled) {
      return null;
    }

    const mint = sighting?.mint || sighting?.token || sighting?.mintAddress;
    if (!mint) {
      return null;
    }

    const record = this.ensureRecord(mint, {
      symbol: sighting.symbol,
      name: sighting.name,
      source: sighting.source || 'telegram_external_sighting',
      createdAt: sighting.firstSeenAt || new Date().toISOString()
    });

    record.symbol = record.symbol || sighting.symbol || null;
    record.name = record.name || sighting.name || null;
    if (!String(record.source || '').startsWith('pumpportal')) {
      record.source = sighting.source || record.source || 'telegram_external_sighting';
    }
    record.createdAt = record.createdAt || sighting.firstSeenAt || new Date().toISOString();

    const state = record.externalSightings || {
      mentionCount: 0,
      firstSeenAt: null,
      lastSeenAt: null,
      chats: [],
      snippets: [],
      refs: []
    };
    const seenRefIds = new Set((state.refs || []).map((ref) => ref.id).filter(Boolean));
    const incomingRefs = Array.isArray(sighting.refs) ? sighting.refs : [];
    const newRefs = incomingRefs.filter((ref) => ref?.id && !seenRefIds.has(ref.id));
    if (newRefs.length === 0 && state.mentionCount > 0) {
      return null;
    }

    state.mentionCount += newRefs.length || Number(sighting.mentionCount || 0);
    state.firstSeenAt = this.minIso(state.firstSeenAt, sighting.firstSeenAt);
    state.lastSeenAt = this.maxIso(state.lastSeenAt, sighting.lastSeenAt);
    state.refs = [...(state.refs || []), ...newRefs].slice(-120);

    const chatMap = new Map((state.chats || []).map((chat) => [String(chat.chatId || chat.chatTitle || 'unknown'), { ...chat }]));
    for (const chat of Array.isArray(sighting.chats) ? sighting.chats : []) {
      const key = String(chat.chatId || chat.chatTitle || '');
      const existing = chatMap.get(key) || {
        chatId: chat.chatId || null,
        chatTitle: chat.chatTitle || null,
        count: 0,
        lastSeenAt: null
      };
      existing.count += Number(chat.count || 0);
      existing.lastSeenAt = this.maxIso(existing.lastSeenAt, chat.lastSeenAt);
      chatMap.set(key, existing);
    }
    state.chats = [...chatMap.values()]
      .sort((a, b) => (b.count || 0) - (a.count || 0))
      .slice(0, 12);

    const existingSnippetKeys = new Set((state.snippets || []).map((snippet) => `${snippet.chatId || 'chat'}:${snippet.date || 'date'}:${snippet.text || ''}`));
    const newSnippets = [];
    for (const snippet of Array.isArray(sighting.snippets) ? sighting.snippets : []) {
      const key = `${snippet.chatId || 'chat'}:${snippet.date || 'date'}:${snippet.text || ''}`;
      if (existingSnippetKeys.has(key)) {
        continue;
      }
      existingSnippetKeys.add(key);
      newSnippets.push({
        chatId: snippet.chatId || null,
        chatTitle: snippet.chatTitle || null,
        date: snippet.date || null,
        text: String(snippet.text || '').slice(0, 220)
      });
    }
    state.snippets = [...(state.snippets || []), ...newSnippets].slice(-8);

    record.externalSightings = state;
    this.updateSummary(record);
    this.appendHistory('external_sighting', {
      mint,
      symbol: record.symbol,
      source: sighting.source || 'telegram_external_sighting',
      mentionCount: Number(sighting.mentionCount || newRefs.length || 0),
      uniqueChatCount: Number(sighting.uniqueChatCount || state.chats.length || 0),
      lastSeenAt: sighting.lastSeenAt || null
    });
    this.compactIfNeeded();
    this.markDirty();
    return record.summary;
  }

  registerPoolState(poolState) {
    if (!this.enabled) {
      return null;
    }

    const mint = poolState?.mintAddress || poolState?.mint || poolState?.token;
    if (!mint) {
      return null;
    }

    const record = this.ensureRecord(mint, {
      symbol: poolState.symbol,
      name: poolState.name,
      source: poolState.source || 'pool_state_lane',
      createdAt: poolState.firstSeenAt || new Date().toISOString()
    });

    record.symbol = record.symbol || poolState.symbol || null;
    record.name = record.name || poolState.name || null;

    const previous = record.poolState || null;
    const next = {
      firstSeenAt: previous?.firstSeenAt || poolState.firstSeenAt || new Date().toISOString(),
      lastSeenAt: poolState.lastSeenAt || new Date().toISOString(),
      bestLiquidityUsd: Math.max(
        Number(previous?.bestLiquidityUsd || 0),
        Number(poolState.bestLiquidityUsd || poolState.bestPool?.liquidityUsd || 0)
      ),
      bestVolume24h: Math.max(
        Number(previous?.bestVolume24h || 0),
        Number(poolState.bestVolume24h || poolState.bestPool?.volume24h || 0)
      ),
      bestPool: poolState.bestPool || previous?.bestPool || null,
      poolCount: Number(poolState.poolCount || poolState.pools?.length || previous?.poolCount || 0),
      pools: Array.isArray(poolState.pools)
        ? poolState.pools.slice(0, 6)
        : (Array.isArray(previous?.pools) ? previous.pools.slice(0, 6) : [])
    };

    const isNewPoolState = !previous;
    const liquidityImproved =
      Number(next.bestLiquidityUsd || 0) > Number(previous?.bestLiquidityUsd || 0) * 1.1;
    const poolCountChanged = Number(next.poolCount || 0) !== Number(previous?.poolCount || 0);

    record.poolState = next;
    this.updateSummary(record);

    if (isNewPoolState || liquidityImproved || poolCountChanged) {
      this.appendHistory('pool_state', {
        mint,
        symbol: record.symbol,
        bestLiquidityUsd: next.bestLiquidityUsd,
        bestVolume24h: next.bestVolume24h,
        poolCount: next.poolCount,
        bestPool: next.bestPool,
        lastSeenAt: next.lastSeenAt
      });
    }

    this.compactIfNeeded();
    this.markDirty();
    return record.summary;
  }

  registerPreMigrationState(preMigrationState) {
    if (!this.enabled) {
      return null;
    }

    const mint = preMigrationState?.mint || preMigrationState?.mintAddress || preMigrationState?.token;
    if (!mint) {
      return null;
    }

    const record = this.ensureRecord(mint, {
      symbol: preMigrationState.symbol,
      name: preMigrationState.name,
      source: preMigrationState.source || 'pre_migration_watch',
      createdAt: preMigrationState.firstSeenAt || new Date().toISOString()
    });

    record.symbol = record.symbol || preMigrationState.symbol || null;
    record.name = record.name || preMigrationState.name || null;

    const previous = record.preMigrationState || null;
    const next = {
      firstSeenAt: previous?.firstSeenAt || preMigrationState.firstSeenAt || new Date().toISOString(),
      lastSeenAt: preMigrationState.lastSeenAt || new Date().toISOString(),
      firstTradeAt: previous?.firstTradeAt || preMigrationState.firstTradeAt || null,
      migratedAt: preMigrationState.migratedAt || previous?.migratedAt || null,
      score: Number(preMigrationState.score || 0),
      reasons: Array.isArray(preMigrationState.reasons) ? preMigrationState.reasons.slice(0, 8) : [],
      flagged: Boolean(previous?.flagged || preMigrationState.flagged),
      flagCount: Math.max(Number(previous?.flagCount || 0), Number(preMigrationState.flagCount || 0)),
      lastFlaggedAt: preMigrationState.lastFlaggedAt || previous?.lastFlaggedAt || null,
      curveProgress: preMigrationState.curveProgress ?? previous?.curveProgress ?? null,
      bondingStage: preMigrationState.bondingStage || previous?.bondingStage || null,
      bondingCurveAddress: preMigrationState.bondingCurveAddress || previous?.bondingCurveAddress || null,
      bondingCurveComplete: Boolean(preMigrationState.bondingCurveComplete || previous?.bondingCurveComplete),
      virtualSolReservesSol: preMigrationState.virtualSolReservesSol ?? previous?.virtualSolReservesSol ?? null,
      realSolReservesSol: preMigrationState.realSolReservesSol ?? previous?.realSolReservesSol ?? null,
      virtualTokenReservesTokens: preMigrationState.virtualTokenReservesTokens ?? previous?.virtualTokenReservesTokens ?? null,
      bondingCurvePriceSol: preMigrationState.bondingCurvePriceSol ?? previous?.bondingCurvePriceSol ?? null,
      tradeCount: Number(preMigrationState.tradeCount || previous?.tradeCount || 0),
      recentTradeCount: Number(preMigrationState.recentTradeCount || previous?.recentTradeCount || 0),
      recentBuys: Number(preMigrationState.recentBuys || previous?.recentBuys || 0),
      recentSells: Number(preMigrationState.recentSells || previous?.recentSells || 0),
      recentVolumeSol: Number(preMigrationState.recentVolumeSol || previous?.recentVolumeSol || 0),
      tradeVelocityPerMin: Number(preMigrationState.tradeVelocityPerMin || previous?.tradeVelocityPerMin || 0),
      holderProxy: Number(preMigrationState.holderProxy || previous?.holderProxy || 0),
      uniqueBuyerCount: Number(preMigrationState.uniqueBuyerCount || previous?.uniqueBuyerCount || 0),
      uniqueBuyerRatio: preMigrationState.uniqueBuyerRatio ?? previous?.uniqueBuyerRatio ?? null,
      externalMentionCount: Number(preMigrationState.externalMentionCount || previous?.externalMentionCount || 0),
      externalChatCount: Number(preMigrationState.externalChatCount || previous?.externalChatCount || 0),
      kolFirstWaveCount: Number(preMigrationState.kolFirstWaveCount || previous?.kolFirstWaveCount || 0),
      kolTrustedCount: Number(preMigrationState.kolTrustedCount || previous?.kolTrustedCount || 0),
      repeatedEarlyBuyerCount: Number(preMigrationState.repeatedEarlyBuyerCount || previous?.repeatedEarlyBuyerCount || 0),
      sniperWalletCount: Number(preMigrationState.sniperWalletCount || previous?.sniperWalletCount || 0),
      bundlerCandidate: Boolean(preMigrationState.bundlerCandidate || previous?.bundlerCandidate)
    };

    const scoreImproved = Number(next.score || 0) > Number(previous?.score || 0) + 5;
    const isNewFlag = Boolean(next.flagged && (!previous?.flagged || next.lastFlaggedAt !== previous?.lastFlaggedAt));
    const migrated = Boolean(next.migratedAt && !previous?.migratedAt);

    record.preMigrationState = next;
    this.updateSummary(record);

    if (isNewFlag || scoreImproved || migrated) {
      this.appendHistory(isNewFlag ? 'pre_migration_flag' : 'pre_migration_update', {
        mint,
        symbol: record.symbol,
        score: next.score,
        reasons: next.reasons,
        curveProgress: next.curveProgress,
        bondingStage: next.bondingStage,
        bondingCurveAddress: next.bondingCurveAddress,
        bondingCurveComplete: next.bondingCurveComplete,
        virtualSolReservesSol: next.virtualSolReservesSol,
        realSolReservesSol: next.realSolReservesSol,
        tradeVelocityPerMin: next.tradeVelocityPerMin,
        recentVolumeSol: next.recentVolumeSol,
        uniqueBuyerCount: next.uniqueBuyerCount,
        uniqueBuyerRatio: next.uniqueBuyerRatio,
        migratedAt: next.migratedAt,
        lastSeenAt: next.lastSeenAt
      });
    }

    this.compactIfNeeded();
    this.markDirty();
    return record.summary;
  }

  updateSummary(record) {
    const firstReferenceMs = record.firstTradeAt
      ? new Date(record.firstTradeAt).getTime()
      : (record.createdAt ? new Date(record.createdAt).getTime() : null);

    const earlyBuyWindow = Number.isFinite(firstReferenceMs)
      ? record.earlyBuys.filter((buy) => buy.timestampMs - firstReferenceMs <= this.sniperWindowMs)
      : [];

    const sniperWallets = [...new Set(earlyBuyWindow.map((buy) => buy.wallet).filter(Boolean))];
    const slotEntries = Object.entries(record.slotBuyCounts || {});
    const slotCluster = slotEntries
      .map(([slot, data]) => ({
        slot,
        walletCount: Array.isArray(data?.wallets) ? data.wallets.length : 0,
        wallets: Array.isArray(data?.wallets) ? data.wallets.slice(0, 8) : []
      }))
      .sort((a, b) => b.walletCount - a.walletCount)[0] || null;

    const firstWaveDistinctWallets = [...new Set(
      (record.earlyBuys || [])
        .filter((buy) => Number.isFinite(firstReferenceMs) && buy.timestampMs - firstReferenceMs <= this.bundlerWindowMs)
        .map((buy) => buy.wallet)
        .filter(Boolean)
    )];

    const crowdedFirstWave = firstWaveDistinctWallets.length >= this.bundlerMinWallets;
    const bundlerCandidate = Boolean(
      slotCluster
      && slotCluster.slot !== null
      && slotCluster.slot !== undefined
      && slotCluster.walletCount >= this.bundlerMinWallets
    );
    const firstWaveCrowdingLevel = crowdedFirstWave
      ? (firstWaveDistinctWallets.length >= this.bundlerMinWallets + 4 ? 'high' : 'medium')
      : (firstWaveDistinctWallets.length >= Math.max(2, this.bundlerMinWallets - 1) ? 'low' : 'none');
    const sniperPresence = sniperWallets.length > 0;
    const sniperCrowdingLevel = sniperWallets.length >= 8
      ? 'high'
      : (sniperWallets.length >= 4 ? 'medium' : (sniperWallets.length >= 1 ? 'low' : 'none'));
    const repeatEarlyBuyerSummaries = firstWaveDistinctWallets
      .map((wallet) => this.getWalletSummary(wallet))
      .filter((entry) => entry && entry.totalLaunches > 1)
      .sort((a, b) => (b.totalLaunches || 0) - (a.totalLaunches || 0))
      .slice(0, 5);
    const firstWaveKolWallets = firstWaveDistinctWallets
      .map((wallet) => this.buildKolWalletSummary(wallet))
      .filter(Boolean)
      .sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER));
    const repeatedEarlyBuyerKolWallets = repeatEarlyBuyerSummaries
      .map((entry) => this.buildKolWalletSummary(entry.wallet, {
        totalLaunches: Number(entry.totalLaunches || 0),
        totalBuyCount: Number(entry.totalBuyCount || 0),
        totalVolumeSol: Number(entry.totalVolumeSol || 0)
      }))
      .filter(Boolean)
      .sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER));
    const kolTrustedCount = firstWaveKolWallets.filter((entry) => entry.trustTier === 'TRUSTED').length;
    const kolAvoidCount = firstWaveKolWallets.filter((entry) => entry.trustTier === 'AVOID').length;

    const summary = {
      mint: record.mint,
      symbol: record.symbol,
      name: record.name,
      source: record.source,
      createdAt: record.createdAt,
      firstTradeAt: record.firstTradeAt,
      migratedAt: record.migratedAt,
      firstObservedSlot: record.firstObservedSlot,
      tradeCount: record.tradeCount,
      buys: record.buys,
      sells: record.sells,
      uniqueBuyerCount: record.uniqueBuyers.length,
      uniqueBuyerSamples: record.uniqueBuyers.slice(0, 12),
      latestLiquiditySol: record.latestLiquiditySol,
      latestMarketCapSol: record.latestMarketCapSol,
      externalSightings: {
        mentionCount: Number(record.externalSightings?.mentionCount || 0),
        firstSeenAt: record.externalSightings?.firstSeenAt || null,
        lastSeenAt: record.externalSightings?.lastSeenAt || null,
        uniqueChatCount: Array.isArray(record.externalSightings?.chats) ? record.externalSightings.chats.length : 0,
        chats: Array.isArray(record.externalSightings?.chats)
          ? record.externalSightings.chats.slice(0, 6)
          : [],
        snippets: Array.isArray(record.externalSightings?.snippets)
          ? record.externalSightings.snippets.slice(-4)
          : []
      },
      poolState: record.poolState
        ? {
            firstSeenAt: record.poolState.firstSeenAt || null,
            lastSeenAt: record.poolState.lastSeenAt || null,
            bestLiquidityUsd: Number(record.poolState.bestLiquidityUsd || 0),
            bestVolume24h: Number(record.poolState.bestVolume24h || 0),
            poolCount: Number(record.poolState.poolCount || 0),
            bestPool: record.poolState.bestPool || null,
            pools: Array.isArray(record.poolState.pools) ? record.poolState.pools.slice(0, 3) : []
          }
        : null,
      preMigrationState: record.preMigrationState
        ? {
            firstSeenAt: record.preMigrationState.firstSeenAt || null,
            lastSeenAt: record.preMigrationState.lastSeenAt || null,
            firstTradeAt: record.preMigrationState.firstTradeAt || null,
            migratedAt: record.preMigrationState.migratedAt || null,
            score: Number(record.preMigrationState.score || 0),
            reasons: Array.isArray(record.preMigrationState.reasons) ? record.preMigrationState.reasons.slice(0, 8) : [],
            flagged: Boolean(record.preMigrationState.flagged),
            flagCount: Number(record.preMigrationState.flagCount || 0),
            lastFlaggedAt: record.preMigrationState.lastFlaggedAt || null,
            curveProgress: record.preMigrationState.curveProgress ?? null,
            bondingStage: record.preMigrationState.bondingStage || null,
            tradeCount: Number(record.preMigrationState.tradeCount || 0),
            recentTradeCount: Number(record.preMigrationState.recentTradeCount || 0),
            recentBuys: Number(record.preMigrationState.recentBuys || 0),
            recentSells: Number(record.preMigrationState.recentSells || 0),
            recentVolumeSol: Number(record.preMigrationState.recentVolumeSol || 0),
            tradeVelocityPerMin: Number(record.preMigrationState.tradeVelocityPerMin || 0),
            holderProxy: Number(record.preMigrationState.holderProxy || 0),
            uniqueBuyerCount: Number(record.preMigrationState.uniqueBuyerCount || 0),
            uniqueBuyerRatio: record.preMigrationState.uniqueBuyerRatio ?? null,
            externalMentionCount: Number(record.preMigrationState.externalMentionCount || 0),
            externalChatCount: Number(record.preMigrationState.externalChatCount || 0),
            kolFirstWaveCount: Number(record.preMigrationState.kolFirstWaveCount || 0),
            kolTrustedCount: Number(record.preMigrationState.kolTrustedCount || 0),
            repeatedEarlyBuyerCount: Number(record.preMigrationState.repeatedEarlyBuyerCount || 0),
            sniperWalletCount: Number(record.preMigrationState.sniperWalletCount || 0),
            bundlerCandidate: Boolean(record.preMigrationState.bundlerCandidate)
          }
        : null,
      deployerWallet: record.deployerWallet,
      deployerActivity: record.deployerActivity.slice(0, Math.min(record.deployerActivity.length, 10)),
      deployerHistory: this.getDeployerSummary(record.deployerWallet),
      repeatEarlyBuyerSummary: repeatEarlyBuyerSummaries,
      earlyBuys: record.earlyBuys.slice(0, Math.min(record.earlyBuys.length, 10)),
      heuristics: {
        sniperWindowMs: this.sniperWindowMs,
        bundlerWindowMs: this.bundlerWindowMs,
        bundlerMinWallets: this.bundlerMinWallets,
        firstWaveBuyCount: earlyBuyWindow.length,
        firstWaveDistinctWalletCount: firstWaveDistinctWallets.length,
        firstWaveCrowding: {
          crowded: crowdedFirstWave,
          level: firstWaveCrowdingLevel,
          walletCount: firstWaveDistinctWallets.length,
          wallets: firstWaveDistinctWallets.slice(0, 8)
        },
        sniperPresence,
        sniperWalletCount: sniperWallets.length,
        sniperWalletCountSource: 'launch_intel_first_reference_buy_window',
        sniperWindowAnchoredAtFirstObservation: Boolean(record.firstTradeAt),
        sniperWindowAnchorAtMs: Number.isFinite(firstReferenceMs) ? firstReferenceMs : null,
        sniperWindowAnchorKind: record.firstTradeAt
          ? 'first_trade'
          : (record.createdAt ? 'created_at' : null),
        sniperCrowdingLevel,
        sniperWallets: sniperWallets.slice(0, 8),
        repeatedEarlyBuyerCount: repeatEarlyBuyerSummaries.length,
        repeatedEarlyBuyerWallets: repeatEarlyBuyerSummaries.map((entry) => entry.wallet),
        externalVisibility: {
          mentionCount: Number(record.externalSightings?.mentionCount || 0),
          uniqueChatCount: Array.isArray(record.externalSightings?.chats) ? record.externalSightings.chats.length : 0,
          firstSeenAt: record.externalSightings?.firstSeenAt || null,
          lastSeenAt: record.externalSightings?.lastSeenAt || null
        },
        poolState: record.poolState
          ? {
              hasPoolState: true,
              bestLiquidityUsd: Number(record.poolState.bestLiquidityUsd || 0),
              bestVolume24h: Number(record.poolState.bestVolume24h || 0),
              poolCount: Number(record.poolState.poolCount || 0),
              bestSource: record.poolState.bestPool?.source || null,
              bestPoolType: record.poolState.bestPool?.poolType || null,
              firstSeenAt: record.poolState.firstSeenAt || null,
              lastSeenAt: record.poolState.lastSeenAt || null
            }
          : {
              hasPoolState: false
            },
        preMigration: record.preMigrationState
          ? {
              tracked: true,
              score: Number(record.preMigrationState.score || 0),
              flagged: Boolean(record.preMigrationState.flagged),
              curveProgress: record.preMigrationState.curveProgress ?? null,
              bondingStage: record.preMigrationState.bondingStage || null,
              reasons: Array.isArray(record.preMigrationState.reasons)
                ? record.preMigrationState.reasons.slice(0, 8)
                : [],
              lastFlaggedAt: record.preMigrationState.lastFlaggedAt || null
            }
          : {
              tracked: false
            },
        kolOverlap: {
          firstWaveCount: firstWaveKolWallets.length,
          trustedCount: kolTrustedCount,
          avoidCount: kolAvoidCount,
          firstWaveWallets: firstWaveKolWallets.slice(0, 5),
          repeatedWalletCount: repeatedEarlyBuyerKolWallets.length,
          repeatedWallets: repeatedEarlyBuyerKolWallets.slice(0, 5)
        },
        deployer: {
          wallet: record.deployerWallet,
          activityCount: record.deployerActivity.length,
          buyCount: record.deployerActivity.filter((event) => event.side === 'buy').length,
          sellCount: record.deployerActivity.filter((event) => event.side === 'sell').length,
          grossVolumeSol: record.deployerActivity.reduce((sum, event) => sum + (event.volumeSol || 0), 0),
          netVolumeSol: record.deployerActivity.reduce((sum, event) => (
            event.side === 'sell'
              ? sum - (event.volumeSol || 0)
              : sum + (event.volumeSol || 0)
          ), 0)
        },
        bundlerCandidate,
        bundlerWalletCount: bundlerCandidate ? slotCluster.walletCount : 0,
        bundlerEvidence: bundlerCandidate
          ? {
              mode: 'slot_cluster',
              slot: slotCluster.slot,
              walletCount: slotCluster.walletCount,
              wallets: slotCluster.wallets
            }
          : null
      }
    };

    const previous = record.summary;
    record.summary = summary;

    if (
      !this.isRehydrating
      && (
      summary.heuristics.bundlerCandidate
      && !previous?.heuristics?.bundlerCandidate
      )
    ) {
      record.heuristicEvents.push({
        type: 'bundler_candidate',
        timestamp: new Date().toISOString(),
        evidence: summary.heuristics.bundlerEvidence
      });
      this.appendHistory('bundler_candidate', {
        mint: record.mint,
        symbol: record.symbol,
        evidence: summary.heuristics.bundlerEvidence
      });
    }

    if (
      !this.isRehydrating
      && (
      summary.heuristics.sniperWalletCount > 0
      && (!previous?.heuristics || previous.heuristics.sniperWalletCount !== summary.heuristics.sniperWalletCount)
      )
    ) {
      this.appendHistory('sniper_update', {
        mint: record.mint,
        symbol: record.symbol,
        sniperWalletCount: summary.heuristics.sniperWalletCount,
        sniperWallets: summary.heuristics.sniperWallets
      });
    }
  }

  getMintSummary(mint) {
    if (!this.enabled || !mint) {
      return null;
    }
    return this.records.get(mint)?.summary || null;
  }

  compactIfNeeded() {
    if (this.records.size <= this.maxTrackedTokens) {
      return;
    }

    const ranked = [...this.records.values()]
      .sort((a, b) => new Date(b.lastTradeAt || b.createdAt || 0).getTime() - new Date(a.lastTradeAt || a.createdAt || 0).getTime())
      .slice(0, this.maxTrackedTokens);

    this.records = new Map(ranked.map((record) => [record.mint, record]));
  }

  markDirty() {
    this.dirty = true;
    if (this.runtimeFlushEnabled) {
      this.flush();
    }
  }

  flush(force = false) {
    if (!this.enabled || !this.dirty) {
      return;
    }

    const now = Date.now();
    if (!force && now - this.lastFlushAt < this.flushIntervalMs) {
      return;
    }
    const shouldFlushIndexes = force || now - this.lastIndexFlushAt >= this.indexFlushIntervalMs;

    const payload = {
      generatedAt: new Date().toISOString(),
      source: this.source,
      items: [...this.records.values()]
        .map((record) => record.summary)
        .filter(Boolean)
        .sort((a, b) => new Date(b.firstTradeAt || b.createdAt || 0).getTime() - new Date(a.firstTradeAt || a.createdAt || 0).getTime())
    };

    try {
      fs.writeFileSync(this.latestFilePath, JSON.stringify(payload, null, 2), 'utf8');
      if (shouldFlushIndexes) {
        fs.writeFileSync(this.deployerIndexFilePath, JSON.stringify({
          generatedAt: new Date().toISOString(),
          source: this.source,
          items: [...this.deployerIndex.values()]
            .map((entry) => ({
              wallet: entry.wallet,
              firstSeen: entry.firstSeen,
              lastSeen: entry.lastSeen,
              totalTokens: entry.totalTokens,
              launches: entry.launches
                .slice()
                .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
            }))
            .sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0))
        }, null, 2), 'utf8');
        fs.writeFileSync(this.walletIndexFilePath, JSON.stringify({
          generatedAt: new Date().toISOString(),
          source: this.source,
          items: [...this.walletIndex.values()]
            .map((entry) => ({
              wallet: entry.wallet,
              firstSeen: entry.firstSeen,
              lastSeen: entry.lastSeen,
              totalLaunches: entry.totalLaunches,
              totalBuyCount: entry.totalBuyCount,
              totalVolumeSol: entry.totalVolumeSol,
              launches: entry.launches
                .slice()
                .sort((a, b) => new Date(b.lastSeen || 0).getTime() - new Date(a.lastSeen || 0).getTime())
            }))
            .sort((a, b) => (b.totalLaunches || 0) - (a.totalLaunches || 0))
        }, null, 2), 'utf8');
        this.lastIndexFlushAt = now;
      }
      this.lastFlushAt = now;
      this.dirty = false;
    } catch (error) {
      this.logger.warn('Failed to flush launch intel state', error.message);
    }
  }

  appendHistory(type, payload) {
    if (!this.enabled) {
      return;
    }

    this.historyWriter?.append({
      type,
      timestamp: new Date().toISOString(),
      source: this.source,
      payload
    }, 'launch intel history');
  }

  async flushAsync() {
    await this.historyWriter?.flush?.();
  }

  getStats() {
    return {
      enabled: this.enabled,
      source: this.source,
      records: this.records.size,
      deployers: this.deployerIndex.size,
      wallets: this.walletIndex.size,
      dirty: this.dirty,
      stateLoad: { ...this.stateLoadStats }
    };
  }

  minIso(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
  }

  maxIso(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
  }
}

module.exports = LaunchIntelStore;
