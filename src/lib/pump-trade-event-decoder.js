'use strict';

const bs58 = require('bs58');

// Pump public IDL: https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json
const EVENT_DISCRIMINATORS = Object.freeze({
  TradeEvent: Buffer.from([189, 219, 127, 211, 78, 230, 97, 238]),
  CreateEvent: Buffer.from([27, 114, 169, 77, 222, 235, 99, 118]),
  CompleteEvent: Buffer.from([95, 114, 97, 156, 212, 46, 152, 8]),
  CompletePumpAmmMigrationEvent: Buffer.from([189, 233, 93, 185, 92, 148, 234, 148])
});
const TRADE_EVENT_DISCRIMINATOR = EVENT_DISCRIMINATORS.TradeEvent;
const MIN_TRADE_EVENT_BYTES = 129;
const NATIVE_SOL_MINT = '11111111111111111111111111111111';
const WRAPPED_SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

class BorshCursor {
  constructor(buffer, offset = 0) {
    this.buffer = buffer;
    this.offset = offset;
  }

  ensure(bytes) {
    if (!Number.isInteger(bytes) || bytes < 0 || this.offset + bytes > this.buffer.length) {
      throw new RangeError(`Borsh buffer exhausted at ${this.offset}; need ${bytes}, have ${this.buffer.length - this.offset}`);
    }
  }

  bytes(length) {
    this.ensure(length);
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u8() {
    this.ensure(1);
    const value = this.buffer[this.offset];
    this.offset += 1;
    return value;
  }

  bool() {
    const value = this.u8();
    if (value !== 0 && value !== 1) throw new RangeError(`Invalid Borsh bool ${value}`);
    return value === 1;
  }

  u16() {
    this.ensure(2);
    const value = this.buffer.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  u32() {
    this.ensure(4);
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u64() {
    this.ensure(8);
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  i64() {
    this.ensure(8);
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  pubkey() {
    return bs58.encode(this.bytes(32));
  }

  string(maxBytes = 8192) {
    const length = this.u32();
    if (length > maxBytes) throw new RangeError(`Borsh string length ${length} exceeds ${maxBytes}`);
    return this.bytes(length).toString('utf8');
  }
}

function decimalString(value) {
  return typeof value === 'bigint' ? value.toString() : null;
}

function discriminatorName(data) {
  if (!Buffer.isBuffer(data) || data.length < 8) return null;
  return Object.entries(EVENT_DISCRIMINATORS)
    .find(([, discriminator]) => data.subarray(0, 8).equals(discriminator))?.[0] || null;
}

function quoteModel(quoteMint, tailDecoded, virtualSolReserves) {
  if (tailDecoded && (quoteMint === NATIVE_SOL_MINT || quoteMint === WRAPPED_SOL_MINT)) return 'sol_quote';
  if (tailDecoded && quoteMint === USDC_MINT) return 'usdc_quote';
  if (tailDecoded && quoteMint) return 'other_quote';
  if (BigInt(virtualSolReserves || 0) > 0n) return 'legacy_sol_quote';
  return 'quote_mint_unsupported';
}

function decodePumpTradeEventData(data) {
  if (!Buffer.isBuffer(data) || data.length < MIN_TRADE_EVENT_BYTES) return null;
  if (discriminatorName(data) !== 'TradeEvent') return null;

  const cursor = new BorshCursor(data, 8);
  const event = {
    eventType: 'TradeEvent',
    mint: cursor.pubkey(),
    solAmount: decimalString(cursor.u64()),
    tokenAmount: decimalString(cursor.u64()),
    isBuy: cursor.bool(),
    user: cursor.pubkey(),
    timestamp: decimalString(cursor.i64()),
    virtualSolReserves: decimalString(cursor.u64()),
    virtualTokenReserves: decimalString(cursor.u64()),
    realSolReserves: decimalString(cursor.u64()),
    realTokenReserves: decimalString(cursor.u64()),
    decodedBytes: cursor.offset,
    totalBytes: data.length,
    tailDecoded: false,
    tailDecodeError: null
  };

  if (cursor.offset < data.length) {
    try {
      event.feeRecipient = cursor.pubkey();
      event.feeBasisPoints = decimalString(cursor.u64());
      event.fee = decimalString(cursor.u64());
      event.creator = cursor.pubkey();
      event.creatorFeeBasisPoints = decimalString(cursor.u64());
      event.creatorFee = decimalString(cursor.u64());
      event.trackVolume = cursor.bool();
      event.totalUnclaimedTokens = decimalString(cursor.u64());
      event.totalClaimedTokens = decimalString(cursor.u64());
      event.currentSolVolume = decimalString(cursor.u64());
      event.lastUpdateTimestamp = decimalString(cursor.i64());
      event.ixName = cursor.string(256);
      event.mayhemMode = cursor.bool();
      event.cashbackFeeBasisPoints = decimalString(cursor.u64());
      event.cashback = decimalString(cursor.u64());
      event.buybackFeeBasisPoints = decimalString(cursor.u64());
      event.buybackFee = decimalString(cursor.u64());
      const shareholderCount = cursor.u32();
      if (shareholderCount > 1024) throw new RangeError(`Shareholder count ${shareholderCount} exceeds 1024`);
      event.shareholders = [];
      for (let index = 0; index < shareholderCount; index += 1) {
        event.shareholders.push({ address: cursor.pubkey(), shareBps: cursor.u16() });
      }
      event.quoteMint = cursor.pubkey();
      event.quoteAmount = decimalString(cursor.u64());
      event.virtualQuoteReserves = decimalString(cursor.u64());
      event.realQuoteReserves = decimalString(cursor.u64());
      event.tailDecoded = true;
      event.decodedBytes = cursor.offset;
    } catch (error) {
      event.tailDecodeError = error.message;
      event.decodedBytes = cursor.offset;
    }
  }

  event.curveModel = quoteModel(event.quoteMint, event.tailDecoded, event.virtualSolReserves);
  return event;
}

function decodeCreateEventData(data) {
  if (discriminatorName(data) !== 'CreateEvent') return null;
  const cursor = new BorshCursor(data, 8);
  try {
    const event = {
      eventType: 'CreateEvent',
      name: cursor.string(),
      symbol: cursor.string(256),
      uri: cursor.string(8192),
      mint: cursor.pubkey(),
      bondingCurve: cursor.pubkey(),
      user: cursor.pubkey(),
      creator: cursor.pubkey(),
      timestamp: decimalString(cursor.i64()),
      virtualTokenReserves: decimalString(cursor.u64()),
      virtualSolReserves: decimalString(cursor.u64()),
      realTokenReserves: decimalString(cursor.u64()),
      tokenTotalSupply: decimalString(cursor.u64()),
      tokenProgram: cursor.pubkey(),
      isMayhemMode: cursor.bool(),
      isCashbackEnabled: cursor.bool(),
      quoteMint: cursor.pubkey(),
      virtualQuoteReserves: decimalString(cursor.u64()),
      decodedBytes: cursor.offset,
      totalBytes: data.length
    };
    event.curveModel = quoteModel(event.quoteMint, true, event.virtualSolReserves);
    return event;
  } catch {
    return null;
  }
}

function decodeCompleteEventData(data) {
  if (discriminatorName(data) !== 'CompleteEvent') return null;
  const cursor = new BorshCursor(data, 8);
  try {
    return {
      eventType: 'CompleteEvent',
      user: cursor.pubkey(),
      mint: cursor.pubkey(),
      bondingCurve: cursor.pubkey(),
      timestamp: decimalString(cursor.i64()),
      quoteMint: cursor.pubkey(),
      decodedBytes: cursor.offset,
      totalBytes: data.length
    };
  } catch {
    return null;
  }
}

function decodeMigrationEventData(data) {
  if (discriminatorName(data) !== 'CompletePumpAmmMigrationEvent') return null;
  const cursor = new BorshCursor(data, 8);
  try {
    return {
      eventType: 'CompletePumpAmmMigrationEvent',
      user: cursor.pubkey(),
      mint: cursor.pubkey(),
      mintAmount: decimalString(cursor.u64()),
      solAmount: decimalString(cursor.u64()),
      poolMigrationFee: decimalString(cursor.u64()),
      bondingCurve: cursor.pubkey(),
      timestamp: decimalString(cursor.i64()),
      pool: cursor.pubkey(),
      quoteMint: cursor.pubkey(),
      decodedBytes: cursor.offset,
      totalBytes: data.length
    };
  } catch {
    return null;
  }
}

function decodePumpEventData(data) {
  const name = discriminatorName(data);
  if (name === 'TradeEvent') return decodePumpTradeEventData(data);
  if (name === 'CreateEvent') return decodeCreateEventData(data);
  if (name === 'CompleteEvent') return decodeCompleteEventData(data);
  if (name === 'CompletePumpAmmMigrationEvent') return decodeMigrationEventData(data);
  return null;
}

function base64DataFromLog(line) {
  const match = String(line || '').match(/^Program data:\s*([A-Za-z0-9+/_=-]+)\s*$/);
  if (!match) return null;
  const normalized = match[1].replace(/-/g, '+').replace(/_/g, '/');
  try {
    return Buffer.from(normalized, 'base64');
  } catch {
    return null;
  }
}

function decodePumpEventLog(line) {
  const data = base64DataFromLog(line);
  if (!data) return null;
  try {
    return decodePumpEventData(data);
  } catch {
    return null;
  }
}

function decodePumpTradeEventLog(line) {
  const event = decodePumpEventLog(line);
  return event?.eventType === 'TradeEvent' ? event : null;
}

function isPumpTradeEventLog(line) {
  const data = base64DataFromLog(line);
  return discriminatorName(data) === 'TradeEvent';
}

module.exports = {
  BorshCursor,
  EVENT_DISCRIMINATORS,
  MIN_TRADE_EVENT_BYTES,
  NATIVE_SOL_MINT,
  TRADE_EVENT_DISCRIMINATOR,
  USDC_MINT,
  WRAPPED_SOL_MINT,
  base64DataFromLog,
  decodeCompleteEventData,
  decodeCreateEventData,
  decodeMigrationEventData,
  decodePumpEventData,
  decodePumpEventLog,
  decodePumpTradeEventData,
  decodePumpTradeEventLog,
  discriminatorName,
  isPumpTradeEventLog,
  quoteModel
};
