#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const https = require('https');
const { Connection, PublicKey } = require('@solana/web3.js');
const Config = require('../src/config');
const SolanaRpcRouter = require('../src/lib/solana-rpc-router');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const TARGETED_PARITY_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-targeted-curve-parity-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'solana-rpc-transport-probe-latest.json');
const DEFAULT_PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function latestFile(pattern) {
  if (!fs.existsSync(LOG_DIR)) return null;
  return fs.readdirSync(LOG_DIR)
    .filter((name) => pattern.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.filePath || null;
}

function battlefieldTelemetryPath() {
  const report = readJson(BATTLEFIELD_PATH, {});
  const telemetryPath = report.files?.telemetryPath || report.telemetryPath || null;
  if (!telemetryPath) return latestFile(/^telemetry-.*\.jsonl$/);
  return path.isAbsolute(telemetryPath) ? telemetryPath : path.join(ROOT, telemetryPath);
}

function redactEndpoint(endpoint) {
  try {
    const parsed = new URL(endpoint);
    return `${parsed.protocol}//${parsed.hostname}${parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : ''}${parsed.search ? '?<redacted>' : ''}`;
  } catch {
    return '<invalid>';
  }
}

function deriveBondingCurveAddress(mint, programId) {
  const mintPublicKey = new PublicKey(mint);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mintPublicKey.toBuffer()],
    programId
  );
  return address.toBase58();
}

function addTarget(targets, target) {
  if (!target?.address) return;
  if (targets.has(target.address)) {
    const existing = targets.get(target.address);
    existing.sources = Array.from(new Set([...(existing.sources || []), ...(target.sources || [])]));
    if (!existing.mint && target.mint) existing.mint = target.mint;
    return;
  }
  targets.set(target.address, target);
}

function collectTargets(maxTargets) {
  const programId = new PublicKey(process.env.PUMP_BONDING_CURVE_PROGRAM_ID || DEFAULT_PUMP_FUN_PROGRAM_ID);
  const targets = new Map();
  const targeted = readJson(TARGETED_PARITY_PATH, { rows: [], highDeltaRows: [] });
  for (const row of [...(targeted.rows || []), ...(targeted.highDeltaRows || [])]) {
    const address = row.bondingCurveAddress || row.expectedBondingCurveAddress;
    if (address) {
      addTarget(targets, {
        address,
        mint: row.mint || null,
        symbol: row.symbol || null,
        sources: ['targeted-parity']
      });
    }
  }

  const telemetryPath = battlefieldTelemetryPath();
  if (telemetryPath && fs.existsSync(telemetryPath)) {
    const lines = fs.readFileSync(telemetryPath, 'utf8').split(/\r?\n/).reverse();
    for (const line of lines) {
      if (targets.size >= maxTargets) break;
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (![
        'pump_bonding_curve.provider_snapshot',
        'provider.pumpdev.shadow_trade',
        'provider.pumpdev.runtime_trade',
        'provider.pumpdev.shadow_new_token',
        'provider.pumpdev.runtime_new_token'
      ].includes(event.type)) {
        continue;
      }
      const payload = event.payload || event.data || {};
      const mint = payload.mint || payload.token || payload.mintAddress || null;
      if (!mint) continue;
      try {
        const address = payload.bondingCurveAddress || payload.bondingCurveKey || deriveBondingCurveAddress(mint, programId);
        addTarget(targets, {
          address,
          mint,
          symbol: payload.symbol || null,
          sources: [event.type]
        });
      } catch {
        // Ignore malformed mints; the probe needs valid account targets only.
      }
    }
  }

  return Array.from(targets.values()).slice(0, maxTargets);
}

function classifyError(error) {
  const message = String(error?.message || error || '');
  if (/abort|timeout|timed out/i.test(message)) return 'timeout';
  if (/429|rate/i.test(message)) return 'rate_limit';
  if (/fetch|socket|network|ECONN|UND_|TLS|ENOTFOUND|ETIMEDOUT/i.test(message)) return 'transport';
  return 'other';
}

function stat(values) {
  const finite = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!finite.length) return { count: 0, median: null, p90: null, max: null, avg: null };
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    median: Math.round(pick(0.5)),
    p90: Math.round(pick(0.9)),
    max: Math.round(finite[finite.length - 1]),
    avg: Math.round(sum / finite.length)
  };
}

function summarizeRows(rows) {
  const summary = {};
  for (const row of rows) {
    const key = `${row.mode}|${row.method}|${row.commitment}`;
    const entry = summary[key] || {
      mode: row.mode,
      method: row.method,
      commitment: row.commitment,
      attempts: 0,
      success: 0,
      timeout: 0,
      rateLimit: 0,
      transport: 0,
      otherErrors: 0,
      latenciesMs: []
    };
    entry.attempts += 1;
    if (row.ok) {
      entry.success += 1;
      entry.latenciesMs.push(row.latencyMs);
    } else if (row.errorClass === 'timeout') {
      entry.timeout += 1;
    } else if (row.errorClass === 'rate_limit') {
      entry.rateLimit += 1;
    } else if (row.errorClass === 'transport') {
      entry.transport += 1;
    } else {
      entry.otherErrors += 1;
    }
    summary[key] = entry;
  }

  return Object.values(summary)
    .map((entry) => ({
      ...entry,
      successRate: entry.attempts ? Number((entry.success / entry.attempts).toFixed(4)) : null,
      latencyMs: stat(entry.latenciesMs)
    }))
    .sort((a, b) => b.successRate - a.successRate || (a.latencyMs.median ?? Infinity) - (b.latencyMs.median ?? Infinity));
}

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    promise: Promise.race([
      promise(controller.signal),
      new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error(`probe timed out after ${timeoutMs}ms`)), { once: true });
      })
    ]).finally(() => clearTimeout(timer))
  };
}

function makeWeb3Connection(url, mode, commitment) {
  if (mode === 'web3-http-agent-false') {
    return new Connection(url, { commitment, httpAgent: false });
  }
  if (mode === 'web3-https-keepalive') {
    const agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 16,
      maxFreeSockets: 8,
      timeout: 5000,
      scheduling: 'lifo'
    });
    return new Connection(url, { commitment, httpAgent: agent });
  }
  return new Connection(url, { commitment });
}

async function web3Call({ url, mode, method, commitment, addresses, timeoutMs }) {
  const connection = makeWeb3Connection(url, mode, commitment);
  const pubkeys = addresses.map((address) => new PublicKey(address));
  const startedAt = Date.now();
  const { promise } = withTimeout(async () => {
    if (method === 'getAccountInfo') {
      return connection.getAccountInfo(pubkeys[0], commitment);
    }
    return connection.getMultipleAccountsInfo(pubkeys, { commitment });
  }, timeoutMs);
  const value = await promise;
  return {
    latencyMs: Date.now() - startedAt,
    accountCount: Array.isArray(value) ? value.filter(Boolean).length : value ? 1 : 0
  };
}

function makeRouter() {
  return new SolanaRpcRouter(Config, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });
}

async function routerCall({ context, method, commitment, addresses }) {
  if (!context.router) {
    context.router = makeRouter();
  }
  const pubkeys = addresses.map((address) => new PublicKey(address));
  const startedAt = Date.now();
  const value = method === 'getAccountInfo'
    ? await context.router.getAccountInfo(pubkeys[0], commitment)
    : await context.router.getMultipleAccountsInfo(pubkeys, { commitment });
  return {
    latencyMs: Date.now() - startedAt,
    accountCount: Array.isArray(value) ? value.filter(Boolean).length : value ? 1 : 0
  };
}

async function rawRpcCall({ url, method, commitment, addresses, timeoutMs }) {
  const rpcMethod = method === 'getAccountInfo' ? 'getAccountInfo' : 'getMultipleAccounts';
  const params = method === 'getAccountInfo'
    ? [addresses[0], { commitment, encoding: 'base64' }]
    : [addresses, { commitment, encoding: 'base64' }];
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: rpcMethod, params });
  const startedAt = Date.now();
  const { signal, promise } = withTimeout(async (abortSignal) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: abortSignal
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`HTTP_${response.status}: ${text.slice(0, 200)}`);
    }
    if (!response.ok || parsed.error) {
      throw new Error(parsed.error?.message || `HTTP_${response.status}`);
    }
    return parsed.result;
  }, timeoutMs);
  void signal;
  const value = await promise;
  const accountCount = method === 'getAccountInfo'
    ? value?.value ? 1 : 0
    : Array.isArray(value?.value) ? value.value.filter(Boolean).length : 0;
  return {
    latencyMs: Date.now() - startedAt,
    accountCount
  };
}

async function maybeWithUndiciAgent(fn) {
  let undici;
  try {
    undici = require('undici');
  } catch {
    return { skipped: true, reason: 'undici module is not available as a require() dependency' };
  }
  const previous = typeof undici.getGlobalDispatcher === 'function' ? undici.getGlobalDispatcher() : null;
  const agent = new undici.Agent({ connections: 16 });
  undici.setGlobalDispatcher(agent);
  try {
    return await fn();
  } finally {
    if (previous) undici.setGlobalDispatcher(previous);
    await agent.close().catch(() => {});
  }
}

async function runOne(rowConfig) {
  const startedAt = Date.now();
  try {
    let result;
    if (rowConfig.mode === 'router-current') {
      result = await routerCall(rowConfig);
    } else if (rowConfig.mode.startsWith('raw-fetch')) {
      result = await rawRpcCall(rowConfig);
    } else {
      result = await web3Call(rowConfig);
    }
    return {
      mode: rowConfig.mode,
      method: rowConfig.method,
      commitment: rowConfig.commitment,
      ok: true,
      latencyMs: result.latencyMs,
      accountCount: result.accountCount,
      errorClass: null,
      errorMessage: null,
      startedAt: new Date(startedAt).toISOString()
    };
  } catch (error) {
    return {
      mode: rowConfig.mode,
      method: rowConfig.method,
      commitment: rowConfig.commitment,
      ok: false,
      latencyMs: Date.now() - startedAt,
      accountCount: 0,
      errorClass: classifyError(error),
      errorMessage: String(error?.message || error).slice(0, 300),
      startedAt: new Date(startedAt).toISOString()
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url || process.env.SOLANA_RPC_URL || '').trim();
  if (!url) {
    throw new Error('SOLANA_RPC_URL is required, or pass --url <rpc-url>.');
  }

  const maxTargets = Math.max(1, Number(args.targets || process.env.SOLANA_RPC_TRANSPORT_PROBE_TARGETS || 4));
  const attempts = Math.max(1, Number(args.attempts || process.env.SOLANA_RPC_TRANSPORT_PROBE_ATTEMPTS || 2));
  const timeoutMs = Math.max(1000, Number(args.timeoutMs || process.env.SOLANA_RPC_TRANSPORT_PROBE_TIMEOUT_MS || process.env.SOLANA_RPC_CALL_TIMEOUT_MS || 10000));
  const delayMs = Math.max(0, Number(args.delayMs || process.env.SOLANA_RPC_TRANSPORT_PROBE_DELAY_MS || 250));
  const targets = collectTargets(maxTargets);
  if (!targets.length) {
    throw new Error('No probe targets found from latest targeted parity report or telemetry.');
  }
  const addresses = targets.map((target) => target.address);
  const modes = [
    'router-current',
    'web3-default',
    'web3-http-agent-false',
    'web3-https-keepalive',
    'raw-fetch-default',
    'raw-fetch-undici-agent',
    'web3-global-undici-agent'
  ];
  const methods = ['getAccountInfo', 'getMultipleAccountsInfo'];
  const commitments = ['confirmed', 'processed'];
  const rows = [];
  const skippedModes = [];

  console.log(`Solana RPC transport probe -> ${redactEndpoint(url)}`);
  console.log(`Targets: ${targets.length}, attempts per combo: ${attempts}, timeout=${timeoutMs}ms`);

  for (const mode of modes) {
    const context = {};
    const runMode = async () => {
      for (const method of methods) {
        for (const commitment of commitments) {
          for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const row = await runOne({
              url,
              mode,
              method,
              commitment,
              addresses: method === 'getAccountInfo' ? addresses.slice(0, 1) : addresses,
              timeoutMs,
              context
            });
            row.attempt = attempt;
            rows.push(row);
            const status = row.ok ? `ok ${row.latencyMs}ms accounts=${row.accountCount}` : `${row.errorClass} ${row.latencyMs}ms ${row.errorMessage}`;
            console.log(`[${mode}] ${method} ${commitment} #${attempt}: ${status}`);
            if (delayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }
      }
    };

    if (mode.endsWith('undici-agent')) {
      const result = await maybeWithUndiciAgent(runMode);
      if (result?.skipped) {
        skippedModes.push({ mode, reason: result.reason });
        console.log(`[${mode}] skipped: ${result.reason}`);
      }
    } else {
      await runMode();
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    endpoint: redactEndpoint(url),
    inputs: {
      maxTargets,
      attempts,
      timeoutMs,
      delayMs,
      node: process.version,
      targets
    },
    skippedModes,
    summary: summarizeRows(rows),
    rows
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
