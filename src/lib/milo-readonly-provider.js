'use strict';

const axios = require('axios');
const { PublicKey } = require('@solana/web3.js');
const {
  compact,
  summarizeEnhancedTransactions,
  summarizeHolderConcentration,
  summarizeSignatures
} = require('./milo-readonly-scout');

const SOL_MINT = 'So11111111111111111111111111111111111111111';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

function safeErrorType(error) {
  const allowed = new Set(['AbortError', 'Error', 'FetchError', 'RangeError', 'TypeError']);
  return allowed.has(error?.name) ? error.name : 'Error';
}

function safeErrorCode(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{1,64}$/.test(normalized) ? normalized : null;
}

function describeError(error) {
  const status = Number(error?.response?.status);
  return {
    type: safeErrorType(error),
    status: Number.isFinite(status) ? status : null,
    code: safeErrorCode(error?.code)
  };
}

function validatePublicKey(value) {
  try {
    return new PublicKey(String(value || '')).toBase58();
  } catch {
    throw new Error('Configured public address is invalid');
  }
}

function rpcUrlFromEnvironment() {
  const configured = process.env.SOLANA_RPC_ACCOUNT_READ_URL || process.env.SOLANA_RPC_URL || '';
  if (configured) return configured;
  const apiKey = process.env.HELIUS_PARSE_API_KEY || process.env.HELIUS_API_KEY || '';
  return apiKey ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}` : '';
}

function flattenExtensions(parsedInfo = {}) {
  const extensions = Array.isArray(parsedInfo.extensions) ? parsedInfo.extensions : [];
  return extensions.map((extension) => String(
    extension?.extension
      || extension?.type
      || extension?.name
      || 'unknown'
  ));
}

function parseMintAccount(accountInfo) {
  const value = accountInfo?.value || null;
  const parsedInfo = value?.data?.parsed?.info || {};
  const extensions = flattenExtensions(parsedInfo);
  return {
    ownerProgram: value?.owner || null,
    executable: Boolean(value?.executable),
    lamports: Number.isFinite(Number(value?.lamports)) ? Number(value.lamports) : null,
    decimals: Number.isFinite(Number(parsedInfo.decimals)) ? Number(parsedInfo.decimals) : null,
    supply: parsedInfo.supply || null,
    mintAuthority: parsedInfo.mintAuthority || null,
    freezeAuthority: parsedInfo.freezeAuthority || null,
    extensions,
    isToken2022: value?.owner === TOKEN_2022_PROGRAM_ID,
    hasTransferHook: extensions.some((extension) => extension.toLowerCase().includes('transferhook'))
  };
}

function parseDASAssets(result = {}) {
  return (Array.isArray(result.items) ? result.items : []).map((asset) => {
    const tokenInfo = asset?.token_info || {};
    const decimals = Number(tokenInfo.decimals || 0);
    const rawBalance = Number(tokenInfo.balance || 0);
    const balance = Number.isFinite(rawBalance) ? rawBalance / (10 ** decimals) : null;
    return {
      mint: asset?.id || null,
      symbol: asset?.content?.metadata?.symbol || null,
      name: asset?.content?.metadata?.name || null,
      balance: compact(balance, 9),
      decimals,
      priceUsd: compact(tokenInfo?.price_info?.price_per_token, 8),
      valueUsd: compact(tokenInfo?.price_info?.total_price, 4),
      interface: asset?.interface || null
    };
  }).filter((asset) => asset.mint && Number(asset.balance || 0) > 0);
}

function parseTokenAccounts(result = {}) {
  return (Array.isArray(result.value) ? result.value : []).map((row) => {
    const info = row?.account?.data?.parsed?.info || {};
    const amount = info?.tokenAmount || {};
    return {
      mint: info.mint || null,
      symbol: null,
      name: null,
      balance: compact(amount.uiAmountString ?? amount.uiAmount, 9),
      decimals: Number.isFinite(Number(amount.decimals)) ? Number(amount.decimals) : null,
      priceUsd: null,
      valueUsd: null,
      interface: row?.account?.owner === TOKEN_2022_PROGRAM_ID ? 'FungibleToken2022' : 'FungibleToken'
    };
  }).filter((asset) => asset.mint && Number(asset.balance || 0) > 0);
}

function mergeHoldings(groups = []) {
  const byMint = new Map();
  for (const holding of groups.flat()) {
    if (!holding?.mint) continue;
    const existing = byMint.get(holding.mint);
    if (!existing) {
      byMint.set(holding.mint, { ...holding });
      continue;
    }
    existing.balance = compact(Number(existing.balance || 0) + Number(holding.balance || 0), 9);
    existing.symbol = existing.symbol || holding.symbol;
    existing.name = existing.name || holding.name;
    existing.priceUsd = existing.priceUsd ?? holding.priceUsd;
    existing.valueUsd = existing.valueUsd ?? holding.valueUsd;
  }
  return Array.from(byMint.values()).sort((left, right) => Number(right.valueUsd || 0) - Number(left.valueUsd || 0));
}

class MiloReadonlyProvider {
  constructor(options = {}) {
    this.rpcUrl = options.rpcUrl || rpcUrlFromEnvironment();
    this.heliusApiKey = options.heliusApiKey
      ?? process.env.HELIUS_PARSE_API_KEY
      ?? process.env.HELIUS_API_KEY
      ?? '';
    this.jupiterApiBaseUrl = String(
      options.jupiterApiBaseUrl || process.env.JUPITER_API_BASE_URL || 'https://lite-api.jup.ag'
    ).replace(/\/$/, '');
    this.jupiterApiKey = options.jupiterApiKey ?? process.env.JUPITER_API_KEY ?? '';
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 12_000));
    this.rpcId = 0;
    this.lastJupiterRequestAt = 0;
    this.jupiterMinRequestIntervalMs = Math.max(0, Number(
      options.jupiterMinRequestIntervalMs || process.env.JUPITER_MIN_REQUEST_INTERVAL_MS || 500
    ));
    this.http = axios.create({
      timeout: this.timeoutMs,
      proxy: process.env.DISABLE_ENV_PROXY === 'false' ? undefined : false,
      headers: { 'User-Agent': 'SpectreMiloReadonlyScout/1.0' }
    });
  }

  capabilities() {
    return {
      rpcConfigured: Boolean(this.rpcUrl),
      heliusEnhancedHistoryConfigured: Boolean(this.heliusApiKey),
      jupiterConfigured: Boolean(this.jupiterApiBaseUrl),
      executionEnabled: false,
      signingEnabled: false
    };
  }

  async rpc(method, params = []) {
    if (!this.rpcUrl) throw new Error('Solana RPC is not configured');
    const response = await this.http.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: ++this.rpcId,
      method,
      params
    });
    if (response.data?.error) {
      const error = new Error('Solana RPC request failed');
      error.code = safeErrorCode(response.data.error.code) || 'RPC_ERROR';
      throw error;
    }
    return response.data?.result;
  }

  async getMintOnchain(mint) {
    const publicKey = validatePublicKey(mint);
    if (!this.rpcUrl) {
      return { coverage: 'missing', reason: 'RPC_NOT_CONFIGURED', mint: publicKey };
    }

    const requests = await Promise.allSettled([
      this.rpc('getAccountInfo', [publicKey, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
      this.rpc('getTokenSupply', [publicKey, { commitment: 'confirmed' }]),
      this.rpc('getTokenLargestAccounts', [publicKey, { commitment: 'confirmed' }])
    ]);
    const [accountResult, supplyResult, largestResult] = requests;
    const failed = requests.filter((result) => result.status === 'rejected');
    const supply = supplyResult.status === 'fulfilled' ? supplyResult.value?.value || null : null;
    const largest = largestResult.status === 'fulfilled' ? largestResult.value?.value || [] : [];

    return {
      coverage: failed.length === 0 ? 'available' : (accountResult.status === 'fulfilled' ? 'partial' : 'missing'),
      mint: accountResult.status === 'fulfilled' ? parseMintAccount(accountResult.value) : null,
      supply: supply ? {
        rawAmount: supply.amount || null,
        decimals: Number.isFinite(Number(supply.decimals)) ? Number(supply.decimals) : null,
        uiAmount: compact(supply.uiAmountString ?? supply.uiAmount, 9)
      } : null,
      holders: summarizeHolderConcentration(largest, supply?.amount),
      checks: {
        accountInfo: accountResult.status === 'fulfilled',
        tokenSupply: supplyResult.status === 'fulfilled',
        largestAccounts: largestResult.status === 'fulfilled'
      },
      errors: failed.map((result) => describeError(result.reason))
    };
  }

  async getEnhancedTransactions(address, limit = 40) {
    const publicKey = validatePublicKey(address);
    if (!this.heliusApiKey) return null;
    const response = await this.http.get(
      `https://api-mainnet.helius-rpc.com/v0/addresses/${publicKey}/transactions`,
      {
        params: {
          'api-key': this.heliusApiKey,
          limit: Math.min(100, Math.max(1, Number(limit || 40)))
        }
      }
    );
    return Array.isArray(response.data) ? response.data : [];
  }

  async getPoolActivity(pairAddress, options = {}) {
    const publicKey = validatePublicKey(pairAddress);
    const nowMs = Number(options.nowMs || Date.now());
    const windowMinutes = Number(options.windowMinutes || 5);
    const limit = Math.min(100, Math.max(1, Number(options.limit || 40)));
    if (!this.rpcUrl) {
      return { coverage: 'missing', reason: 'RPC_NOT_CONFIGURED', address: publicKey };
    }

    const [signatureResult, enhancedResult] = await Promise.allSettled([
      this.rpc('getSignaturesForAddress', [publicKey, { limit, commitment: 'confirmed' }]),
      this.getEnhancedTransactions(publicKey, limit)
    ]);
    const signatures = signatureResult.status === 'fulfilled' ? signatureResult.value || [] : [];
    const enhanced = enhancedResult.status === 'fulfilled' && Array.isArray(enhancedResult.value)
      ? enhancedResult.value
      : [];

    return {
      coverage: signatureResult.status === 'fulfilled' ? 'available' : 'missing',
      address: publicKey,
      signatures: summarizeSignatures(signatures, nowMs, windowMinutes),
      enhanced: summarizeEnhancedTransactions(enhanced, nowMs, windowMinutes),
      checks: {
        signatures: signatureResult.status === 'fulfilled',
        enhancedHistory: enhancedResult.status === 'fulfilled' && enhancedResult.value !== null
      },
      errors: [signatureResult, enhancedResult]
        .filter((result) => result.status === 'rejected')
        .map((result) => describeError(result.reason))
    };
  }

  async waitForJupiterSlot() {
    const elapsed = Date.now() - this.lastJupiterRequestAt;
    if (elapsed < this.jupiterMinRequestIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.jupiterMinRequestIntervalMs - elapsed));
    }
    this.lastJupiterRequestAt = Date.now();
  }

  async getJupiterQuote(outputMint, sizeUsd) {
    const publicKey = validatePublicKey(outputMint);
    const amount = Math.round(Number(sizeUsd) * 1_000_000);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { available: false, sizeUsd: Number(sizeUsd), reason: 'INVALID_QUOTE_SIZE' };
    }

    try {
      await this.waitForJupiterSlot();
      const response = await this.http.get(`${this.jupiterApiBaseUrl}/ultra/v1/order`, {
        params: {
          inputMint: USDC_MINT,
          outputMint: publicKey,
          amount
        },
        headers: this.jupiterApiKey ? { 'x-api-key': this.jupiterApiKey } : {}
      });
      const quote = response.data || {};
      if (!quote.outAmount || quote.errorCode) {
        return {
          available: false,
          sizeUsd: Number(sizeUsd),
          reason: 'JUPITER_QUOTE_REJECTED',
          code: safeErrorCode(quote.errorCode)
        };
      }

      return {
        available: true,
        sizeUsd: Number(sizeUsd),
        inputMint: USDC_MINT,
        outputMint: publicKey,
        inAmount: quote.inAmount || String(amount),
        outAmount: quote.outAmount,
        priceImpactPct: compact(quote.priceImpactPct ?? quote.priceImpact, 6),
        swapType: quote.swapType || null,
        route: (Array.isArray(quote.routePlan) ? quote.routePlan : []).map((step) => ({
          label: step?.swapInfo?.label || null,
          percent: Number.isFinite(Number(step?.percent)) ? Number(step.percent) : null,
          feeAmount: step?.swapInfo?.feeAmount || null,
          feeMint: step?.swapInfo?.feeMint || null
        })),
        totalTimeMs: Number.isFinite(Number(quote.totalTime)) ? Number(quote.totalTime) : null
      };
    } catch (error) {
      return {
        available: false,
        sizeUsd: Number(sizeUsd),
        reason: 'JUPITER_QUOTE_FAILED',
        error: describeError(error)
      };
    }
  }

  async getFallbackTokenAccounts(ownerAddress) {
    const paramsFor = (programId) => [
      ownerAddress,
      { programId },
      { encoding: 'jsonParsed', commitment: 'confirmed' }
    ];
    const results = await Promise.allSettled([
      this.rpc('getTokenAccountsByOwner', paramsFor(TOKEN_PROGRAM_ID)),
      this.rpc('getTokenAccountsByOwner', paramsFor(TOKEN_2022_PROGRAM_ID))
    ]);
    return mergeHoldings(results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => parseTokenAccounts(result.value)));
  }

  async getWalletSnapshot(walletAddress, options = {}) {
    const ownerAddress = validatePublicKey(walletAddress);
    if (!this.rpcUrl) {
      return { coverage: 'missing', reason: 'RPC_NOT_CONFIGURED', walletAddress: ownerAddress };
    }

    const [balanceResult, dasResult, historyResult] = await Promise.allSettled([
      this.rpc('getBalance', [ownerAddress, { commitment: 'confirmed' }]),
      this.rpc('getAssetsByOwner', {
        ownerAddress,
        page: 1,
        limit: 1000,
        displayOptions: {
          showFungible: true,
          showNativeBalance: true,
          showZeroBalance: false
        }
      }),
      this.getEnhancedTransactions(ownerAddress, Number(options.enhancedTransactionLimit || 40))
    ]);
    let holdings = dasResult.status === 'fulfilled' ? parseDASAssets(dasResult.value) : [];
    let holdingsSource = dasResult.status === 'fulfilled' ? 'helius_das' : 'standard_rpc_fallback';
    if (dasResult.status !== 'fulfilled') {
      try {
        holdings = await this.getFallbackTokenAccounts(ownerAddress);
      } catch {
        holdings = [];
      }
    }
    const lamports = balanceResult.status === 'fulfilled'
      ? Number(balanceResult.value?.value || 0)
      : null;
    const enhancedTransactions = historyResult.status === 'fulfilled' && Array.isArray(historyResult.value)
      ? historyResult.value
      : [];

    return {
      generatedAt: new Date().toISOString(),
      coverage: balanceResult.status === 'fulfilled' ? 'available' : 'partial',
      walletAddress: ownerAddress,
      native: {
        mint: SOL_MINT,
        symbol: 'SOL',
        lamports,
        balance: lamports === null ? null : compact(lamports / 1_000_000_000, 9)
      },
      holdings,
      holdingsSource,
      enhancedHistory: {
        coverage: historyResult.status === 'fulfilled' && historyResult.value !== null ? 'available' : 'missing',
        transactionsFetched: enhancedTransactions.length,
        newestSignature: enhancedTransactions[0]?.signature || null,
        newestTimestamp: enhancedTransactions[0]?.timestamp || null,
        recentTransactions: enhancedTransactions.slice(0, 20).map((transaction) => ({
          signature: transaction?.signature || null,
          timestamp: transaction?.timestamp || null,
          type: transaction?.type || null,
          source: transaction?.source || null,
          fee: Number.isFinite(Number(transaction?.fee)) ? Number(transaction.fee) : null,
          tokenTransfers: (Array.isArray(transaction?.tokenTransfers) ? transaction.tokenTransfers : [])
            .slice(0, 12)
            .map((transfer) => ({
              mint: transfer?.mint || null,
              tokenAmount: compact(transfer?.tokenAmount, 9),
              fromUserAccount: transfer?.fromUserAccount || null,
              toUserAccount: transfer?.toUserAccount || null
            })),
          nativeTransfers: (Array.isArray(transaction?.nativeTransfers) ? transaction.nativeTransfers : [])
            .slice(0, 12)
            .map((transfer) => ({
              amountLamports: Number.isFinite(Number(transfer?.amount)) ? Number(transfer.amount) : null,
              fromUserAccount: transfer?.fromUserAccount || null,
              toUserAccount: transfer?.toUserAccount || null
            }))
        }))
      },
      errors: [balanceResult, dasResult, historyResult]
        .filter((result) => result.status === 'rejected')
        .map((result) => describeError(result.reason))
    };
  }
}

module.exports = {
  MiloReadonlyProvider,
  SOL_MINT,
  USDC_MINT,
  describeError,
  mergeHoldings,
  parseDASAssets,
  parseMintAccount,
  validatePublicKey
};
