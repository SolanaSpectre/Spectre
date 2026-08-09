'use strict';

// Maps Helius pump.fun events onto the event shape LaunchIntelStore expects.
//
// Launch intel has only ever been fed from the PumpPortal tape. Every wallet-conditioned entry
// gate depends on it, so it has to survive PumpPortal being retired - on 2026-08-03 a missing
// wallet-intel file silently failed 100% of positive-wallet gates and held the lane to 3 entries
// per session until it was rebuilt.
//
// Two shape differences matter:
//
//  1. LaunchIntelStore reads trade timestamps with Number(event.timestamp || event.blockTime),
//     so an ISO string parses to NaN. Helius carries eventAt as ISO; it must be converted to
//     epoch milliseconds here rather than passed through.
//  2. PumpPortal repeats symbol/name on every trade. Helius only carries them on CreateEvent.
//     registerTrade preserves the existing record's symbol/name when the event omits them, so
//     trade rows rely on the create event having seeded the record first. A mint first seen
//     mid-life keeps a null symbol until a later source fills it, which matches how the store
//     already behaves for PumpPortal trades that arrive before their create event.

function toEpochMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapHeliusCreateToLaunchIntelEvent(payload = {}) {
  const mint = payload.mint || null;
  if (!mint) return null;
  return {
    mint,
    symbol: payload.symbol || null,
    name: payload.name || null,
    source: payload.strategyConsumptionEnabled === true
      ? 'helius_pumpfun_runtime_create'
      : 'helius_pumpfun_shadow_create',
    // registerNewToken checks deployerWallet, then creator, then author/founder/traderPublicKey.
    // Helius CreateEvent carries both creator and user; creator is the deploying authority.
    creator: payload.creator || payload.user || null,
    signature: payload.signature || null,
    slot: finite(payload.slot),
    timestamp: toEpochMs(payload.eventAt) ?? toEpochMs(payload.receivedAt)
  };
}

function mapHeliusTradeToLaunchIntelEvent(payload = {}) {
  const mint = payload.mint || null;
  if (!mint) return null;
  const side = String(payload.txType || '').toLowerCase();
  if (side !== 'buy' && side !== 'sell') return null;
  const timestamp = toEpochMs(payload.eventAt) ?? toEpochMs(payload.receivedAt);
  if (timestamp === null) return null;
  return {
    mint,
    symbol: payload.symbol || null,
    name: payload.name || null,
    source: payload.strategyConsumptionEnabled === true
      ? 'helius_pumpfun_runtime_trade'
      : 'helius_pumpfun_shadow_trade',
    txType: side,
    timestamp,
    slot: finite(payload.slot),
    traderPublicKey: payload.traderPublicKey || payload.user || null,
    signature: payload.signature || null,
    solAmount: finite(payload.solAmount),
    vSolInBondingCurve: finite(payload.virtualQuoteReservesUi)
  };
}

module.exports = {
  finite,
  mapHeliusCreateToLaunchIntelEvent,
  mapHeliusTradeToLaunchIntelEvent,
  toEpochMs
};
