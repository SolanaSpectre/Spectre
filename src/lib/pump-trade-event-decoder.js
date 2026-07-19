'use strict';

const bs58 = require('bs58');

// Pump public IDL: https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
const TRADE_EVENT_DISCRIMINATOR = Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]);
const MIN_TRADE_EVENT_BYTES = 129;

function readU64(buffer, offset) {
  return buffer.readBigUInt64LE(offset);
}

function readI64(buffer, offset) {
  return buffer.readBigInt64LE(offset);
}

function decimalString(value) {
  return typeof value === 'bigint' ? value.toString() : null;
}

function decodePumpTradeEventData(data) {
  if (!Buffer.isBuffer(data) || data.length < MIN_TRADE_EVENT_BYTES) return null;
  if (!data.subarray(0, 8).equals(TRADE_EVENT_DISCRIMINATOR)) return null;

  let offset = 8;
  const mint = bs58.encode(data.subarray(offset, offset + 32));
  offset += 32;
  const solAmount = readU64(data, offset);
  offset += 8;
  const tokenAmount = readU64(data, offset);
  offset += 8;
  const isBuy = data[offset] === 1;
  offset += 1;
  const user = bs58.encode(data.subarray(offset, offset + 32));
  offset += 32;
  const timestamp = readI64(data, offset);
  offset += 8;
  const virtualSolReserves = readU64(data, offset);
  offset += 8;
  const virtualTokenReserves = readU64(data, offset);
  offset += 8;
  const realSolReserves = readU64(data, offset);
  offset += 8;
  const realTokenReserves = readU64(data, offset);

  return {
    mint,
    user,
    isBuy,
    timestamp: decimalString(timestamp),
    solAmount: decimalString(solAmount),
    tokenAmount: decimalString(tokenAmount),
    virtualSolReserves: decimalString(virtualSolReserves),
    virtualTokenReserves: decimalString(virtualTokenReserves),
    realSolReserves: decimalString(realSolReserves),
    realTokenReserves: decimalString(realTokenReserves),
    decodedBytes: MIN_TRADE_EVENT_BYTES,
    totalBytes: data.length
  };
}

function decodePumpTradeEventLog(line) {
  const match = String(line || '').match(/^Program data:\s*([A-Za-z0-9+/=]+)\s*$/);
  if (!match) return null;

  let data;
  try {
    data = Buffer.from(match[1], 'base64');
  } catch {
    return null;
  }
  return decodePumpTradeEventData(data);
}

function isPumpTradeEventLog(line) {
  const match = String(line || '').match(/^Program data:\s*([A-Za-z0-9+/=]+)\s*$/);
  if (!match) return false;
  try {
    const data = Buffer.from(match[1], 'base64');
    return data.length >= 8 && data.subarray(0, 8).equals(TRADE_EVENT_DISCRIMINATOR);
  } catch {
    return false;
  }
}

module.exports = {
  MIN_TRADE_EVENT_BYTES,
  TRADE_EVENT_DISCRIMINATOR,
  decodePumpTradeEventData,
  decodePumpTradeEventLog,
  isPumpTradeEventLog
};
