'use strict';

const PUMP_FAMILY_SOURCE_PREFIXES = Object.freeze([
  'pumpportal',
  'pumpdev',
  'pumpfun',
  'helius_pumpfun_runtime_'
]);

const PUMP_FAMILY_RUNTIME_SOURCES = Object.freeze([
  'helius_logs_create_runtime',
  'helius_logs_trade_runtime',
  'helius_logs_complete_runtime',
  'helius_logs_migration_runtime'
]);

function tokenSources(token = {}) {
  return [
    token.source,
    token.raw?.source,
    token.rawEvent?.source,
    token.rawTrade?.source
  ].filter((value) => value !== null && value !== undefined && value !== '');
}

function isPumpFamilySource(value) {
  const source = String(value || '').trim().toLowerCase();
  return PUMP_FAMILY_RUNTIME_SOURCES.includes(source)
    || PUMP_FAMILY_SOURCE_PREFIXES.some((prefix) => source.startsWith(prefix));
}

function isPumpFamilyToken(token = {}) {
  return tokenSources(token).some(isPumpFamilySource);
}

function summarizePumpFamilyMomentum(token = {}, windowMs, nowMs = Date.now()) {
  const normalizedWindowMs = Math.max(1, Number(windowMs || 0));
  const normalizedNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const trades = (Array.isArray(token.tradeWindow) ? token.tradeWindow : [])
    .filter((trade) => {
      const timestamp = Number(trade?.timestamp);
      return Number.isFinite(timestamp) && normalizedNowMs - timestamp <= normalizedWindowMs;
    });
  const recentBuys = trades.filter((trade) => trade.side === 'buy').length;
  const recentSells = trades.filter((trade) => trade.side === 'sell').length;
  const recentVolumeSol = trades.reduce((sum, trade) => sum + Number(trade.volumeSol || 0), 0);
  const minutes = Math.max(normalizedWindowMs / 60_000, 0.001);

  return {
    recentBuys,
    recentSells,
    recentTradeCount: trades.length,
    recentVolumeSol,
    tradeVelocityPerMin: trades.length / minutes,
    tokenAgeSeconds: token.createdAt ? (normalizedNowMs - Number(token.createdAt)) / 1000 : 0
  };
}

module.exports = {
  PUMP_FAMILY_SOURCE_PREFIXES,
  PUMP_FAMILY_RUNTIME_SOURCES,
  isPumpFamilySource,
  isPumpFamilyToken,
  summarizePumpFamilyMomentum,
  tokenSources
};
