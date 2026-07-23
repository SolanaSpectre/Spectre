'use strict';

const { Connection, PublicKey } = require('@solana/web3.js');

const LAMPORTS_PER_SOL = 1_000_000_000;
const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DEFAULT_PROVIDER_FLOOR_SOL = 0.02;
const DEFAULT_BUFFER_SOL = 0.005;
const EVENTS_PER_CHARGE_BLOCK = 10_000;
const SOL_PER_CHARGE_BLOCK = 0.01;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function projectedMeteredChargeSol(maxMeteredTradeEvents) {
  const events = number(maxMeteredTradeEvents, 0);
  if (events <= 0) return null;
  return Math.floor(events / EVENTS_PER_CHARGE_BLOCK) * SOL_PER_CHARGE_BLOCK;
}

function requiredStartingBalanceSol({
  maxMeteredTradeEvents,
  providerFloorSol = DEFAULT_PROVIDER_FLOOR_SOL,
  bufferSol = DEFAULT_BUFFER_SOL
} = {}) {
  const projectedChargeSol = projectedMeteredChargeSol(maxMeteredTradeEvents);
  if (projectedChargeSol === null) return null;
  return Number((
    Math.max(0, number(providerFloorSol, DEFAULT_PROVIDER_FLOOR_SOL))
    + projectedChargeSol
    + Math.max(0, number(bufferSol, DEFAULT_BUFFER_SOL))
  ).toFixed(9));
}

function abbreviatedAddress(address) {
  const value = String(address || '');
  return value.length > 12 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value;
}

function safeErrorType(error) {
  const allowedNames = new Set([
    'AbortError',
    'Error',
    'FetchError',
    'RangeError',
    'TypeError'
  ]);
  return allowedNames.has(error?.name) ? error.name : 'Error';
}

async function readBalanceSol(address, rpcUrl = DEFAULT_RPC_URL) {
  const publicKey = new PublicKey(address);
  const connection = new Connection(rpcUrl, 'confirmed');
  const lamports = await connection.getBalance(publicKey, 'confirmed');
  return lamports / LAMPORTS_PER_SOL;
}

async function checkPumpPortalFunding({
  env = process.env,
  getBalanceSol = readBalanceSol
} = {}) {
  const pumpPortalEnabled = env.PUMPPORTAL_ENABLED !== 'false';
  const paidStreamsConfigured = Boolean(env.PUMP_PORTAL_API_KEY);
  const address = String(env.PUMPPORTAL_FUNDED_WALLET_ADDRESS || '').trim();
  const required = env.PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED === 'true';
  const maxMeteredTradeEvents = number(
    env.PUMPPORTAL_MAX_METERED_TRADE_EVENTS_PER_SESSION,
    30000
  );

  if (!pumpPortalEnabled || !paidStreamsConfigured) {
    return { status: 'SKIPPED_PAID_TAPE_DISABLED' };
  }

  if (!address) {
    if (required) {
      throw new Error(
        'PUMPPORTAL_FUNDED_WALLET_ADDRESS is required while PUMPPORTAL_FUNDING_PREFLIGHT_REQUIRED=true'
      );
    }
    return { status: 'SKIPPED_NO_PUBLIC_WALLET_ADDRESS' };
  }

  if (maxMeteredTradeEvents <= 0) {
    throw new Error(
      'PumpPortal funding preflight cannot bound an unlimited paid-tape session; set PUMPPORTAL_MAX_METERED_TRADE_EVENTS_PER_SESSION above zero'
    );
  }

  // Validate before making an RPC call and never expose the configured endpoint in output.
  let normalizedAddress;
  try {
    normalizedAddress = new PublicKey(address).toBase58();
  } catch {
    throw new Error('PUMPPORTAL_FUNDED_WALLET_ADDRESS is not a valid Solana public address');
  }
  const providerFloorSol = number(
    env.PUMPPORTAL_PROVIDER_MIN_FUNDED_BALANCE_SOL,
    DEFAULT_PROVIDER_FLOOR_SOL
  );
  const bufferSol = number(
    env.PUMPPORTAL_FUNDING_PREFLIGHT_BUFFER_SOL,
    DEFAULT_BUFFER_SOL
  );
  const projectedChargeSol = projectedMeteredChargeSol(maxMeteredTradeEvents);
  const requiredBalanceSol = requiredStartingBalanceSol({
    maxMeteredTradeEvents,
    providerFloorSol,
    bufferSol
  });
  const rpcUrl = env.SOLANA_RPC_ACCOUNT_READ_URL || env.SOLANA_RPC_URL || DEFAULT_RPC_URL;
  let rawBalanceSol;
  try {
    rawBalanceSol = await getBalanceSol(normalizedAddress, rpcUrl);
  } catch (error) {
    throw new Error(
      `PumpPortal funding preflight RPC balance read failed (${safeErrorType(error)})`
    );
  }
  const balanceSol = number(rawBalanceSol, NaN);

  if (!Number.isFinite(balanceSol)) {
    throw new Error('PumpPortal funding preflight could not read a finite wallet balance');
  }

  const result = {
    status: balanceSol >= requiredBalanceSol ? 'PASS' : 'INSUFFICIENT_BALANCE',
    address: normalizedAddress,
    addressLabel: abbreviatedAddress(normalizedAddress),
    balanceSol: Number(balanceSol.toFixed(9)),
    requiredBalanceSol,
    providerFloorSol,
    projectedChargeSol,
    bufferSol,
    maxMeteredTradeEvents
  };

  if (result.status !== 'PASS') {
    throw new Error(
      `PumpPortal wallet ${result.addressLabel} has ${result.balanceSol.toFixed(6)} SOL; `
      + `at least ${requiredBalanceSol.toFixed(6)} SOL is required for the configured paid-tape budget`
    );
  }

  return result;
}

module.exports = {
  DEFAULT_BUFFER_SOL,
  DEFAULT_PROVIDER_FLOOR_SOL,
  EVENTS_PER_CHARGE_BLOCK,
  SOL_PER_CHARGE_BLOCK,
  abbreviatedAddress,
  checkPumpPortalFunding,
  projectedMeteredChargeSol,
  readBalanceSol,
  requiredStartingBalanceSol,
  safeErrorType
};
