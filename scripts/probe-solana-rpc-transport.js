#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { isRuntimeProviderEvent } = require('./lib/runtime-provider-events');
const https = require('https');
const { Connection, PublicKey } = require('@solana/web3.js');
const SolanaRpcRouter = require('../src/lib/solana-rpc-router');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const BATTLEFIELD_PATH = path.join(ROOT, 'data', 'reports', 'run-battlefield-latest.json');
const TARGETED_PARITY_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-targeted-curve-parity-latest.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'reports', 'solana-rpc-transport-probe-latest.json');
const DEFAULT_PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const DEFAULT_SCAN_CHUNK_BYTES = 1024 * 1024;
const DEFAULT_SCAN_MAX_BYTES = 64 * 1024 * 1024;

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
    const port = parsed.port ? `:${parsed.port}` : '';
    const pathname = parsed.pathname && parsed.pathname !== '/' ? '/<redacted-path>' : '';
    return `${parsed.protocol}//${parsed.hostname}${port}${pathname}${parsed.search ? '?<redacted>' : ''}`;
  } catch {
    return '<invalid>';
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function endpointSecrets(endpoint) {
  const secrets = new Set();
  const raw = String(endpoint || '').trim();
  if (!raw) return secrets;
  secrets.add(raw);
  try {
    const parsed = new URL(raw);
    secrets.add(parsed.href);
    if (parsed.username) secrets.add(decodeURIComponent(parsed.username));
    if (parsed.password) secrets.add(decodeURIComponent(parsed.password));
    for (const segment of parsed.pathname.split('/')) {
      if (segment.length >= 8) secrets.add(decodeURIComponent(segment));
    }
    for (const value of parsed.searchParams.values()) {
      if (value.length >= 8) secrets.add(value);
    }
  } catch {
    // The generic URL scrub below still covers URL-shaped text.
  }
  return secrets;
}

function sanitizeProbeError(error, endpoints = []) {
  let message = String(error?.message || error || '');
  const secrets = new Set();
  for (const endpoint of endpoints) {
    for (const secret of endpointSecrets(endpoint)) {
      if (secret) secrets.add(secret);
    }
  }
  for (const secret of Array.from(secrets).sort((a, b) => b.length - a.length)) {
    message = message.replace(new RegExp(escapeRegExp(secret), 'g'), '<redacted>');
  }
  message = message
    .replace(/https?:\/\/[^\s"'`<>)\]}]+/gi, '<redacted-url>')
    .replace(/\b(api[-_]?key|token|key)=([^\s&"'`]+)/gi, '$1=<redacted>');
  return message.slice(0, 300);
}

function forEachRecentJsonlSync(filePath, onRow, options = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      fileSizeBytes: 0,
      bytesRead: 0,
      rowsVisited: 0,
      malformedLines: 0,
      stoppedEarly: false,
      hitByteLimit: false
    };
  }

  const chunkBytes = Math.max(16, Number(options.chunkBytes || DEFAULT_SCAN_CHUNK_BYTES));
  const maxBytes = Math.max(chunkBytes, Number(options.maxBytes || DEFAULT_SCAN_MAX_BYTES));
  const fd = fs.openSync(filePath, 'r');
  const fileSizeBytes = fs.fstatSync(fd).size;
  let position = fileSizeBytes;
  let carry = Buffer.alloc(0);
  let bytesRead = 0;
  let rowsVisited = 0;
  let malformedLines = 0;
  let stoppedEarly = false;

  const visit = (lineBuffer) => {
    const line = lineBuffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (!line) return true;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      malformedLines += 1;
      return true;
    }
    rowsVisited += 1;
    if (onRow(row, line) === false) {
      stoppedEarly = true;
      return false;
    }
    return true;
  };

  try {
    while (position > 0 && bytesRead < maxBytes && !stoppedEarly) {
      const length = Math.min(chunkBytes, position, maxBytes - bytesRead);
      if (length <= 0) break;
      const start = position - length;
      const chunk = Buffer.allocUnsafe(length);
      const actualBytes = fs.readSync(fd, chunk, 0, length, start);
      position = start;
      bytesRead += actualBytes;

      const combined = carry.length
        ? Buffer.concat([chunk.subarray(0, actualBytes), carry])
        : chunk.subarray(0, actualBytes);
      let lineEnd = combined.length;
      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        if (!visit(combined.subarray(index + 1, lineEnd))) break;
        lineEnd = index;
      }
      carry = stoppedEarly ? Buffer.alloc(0) : Buffer.from(combined.subarray(0, lineEnd));
    }

    if (!stoppedEarly && position === 0 && carry.length) {
      visit(carry);
    }
  } finally {
    fs.closeSync(fd);
  }

  return {
    fileSizeBytes,
    bytesRead,
    rowsVisited,
    malformedLines,
    stoppedEarly,
    hitByteLimit: position > 0 && bytesRead >= maxBytes
  };
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

function collectTargets(maxTargets, options = {}) {
  const programId = new PublicKey(options.pumpProgramId || DEFAULT_PUMP_FUN_PROGRAM_ID);
  const targets = new Map();
  const targeted = readJson(options.targetedParityPath || TARGETED_PARITY_PATH, { rows: [], highDeltaRows: [] });
  for (const row of [...(targeted.rows || []), ...(targeted.highDeltaRows || [])]) {
    if (targets.size >= maxTargets) break;
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

  const telemetryPath = options.telemetryPath || battlefieldTelemetryPath();
  let telemetryScan = null;
  if (targets.size < maxTargets && telemetryPath && fs.existsSync(telemetryPath)) {
    telemetryScan = forEachRecentJsonlSync(telemetryPath, (event) => {
      if (event.type !== 'pump_bonding_curve.provider_snapshot'
        && !isRuntimeProviderEvent(event, 'trade')
        && !isRuntimeProviderEvent(event, 'newToken')) {
        return true;
      }
      const payload = event.payload || event.data || {};
      const mint = payload.mint || payload.token || payload.mintAddress || null;
      if (!mint) return true;
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
      return targets.size < maxTargets;
    }, {
      chunkBytes: options.scanChunkBytes,
      maxBytes: options.scanMaxBytes
    });
  }

  return {
    targets: Array.from(targets.values()).slice(0, maxTargets),
    telemetryPath,
    telemetryScan
  };
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

function makeRouter(config) {
  return new SolanaRpcRouter(config, {
    info: () => {},
    warn: () => {},
    error: () => {}
  });
}

async function routerCall({ context, method, commitment, addresses }) {
  if (!context.router) {
    context.router = makeRouter(context.config);
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
      errorMessage: sanitizeProbeError(error, rowConfig.sensitiveEndpoints),
      startedAt: new Date(startedAt).toISOString()
    };
  }
}

async function main() {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
  const Config = require('../src/config');
  const args = parseArgs(process.argv.slice(2));
  const url = String(args.url || Config.solanaRpcUrl || '').trim();
  if (!url) {
    throw new Error('SOLANA_RPC_URL is required, or pass --url <rpc-url>.');
  }

  const maxTargets = Math.max(1, Number(args.targets || process.env.SOLANA_RPC_TRANSPORT_PROBE_TARGETS || 4));
  const attempts = Math.max(1, Number(args.attempts || process.env.SOLANA_RPC_TRANSPORT_PROBE_ATTEMPTS || 2));
  const timeoutMs = Math.max(1000, Number(args.timeoutMs || process.env.SOLANA_RPC_TRANSPORT_PROBE_TIMEOUT_MS || process.env.SOLANA_RPC_CALL_TIMEOUT_MS || 10000));
  const delayMs = Math.max(0, Number(args.delayMs || process.env.SOLANA_RPC_TRANSPORT_PROBE_DELAY_MS || 250));
  const scanMaxBytes = Math.max(
    DEFAULT_SCAN_CHUNK_BYTES,
    Number(args.scanMaxBytes || process.env.SOLANA_RPC_TRANSPORT_PROBE_SCAN_MAX_BYTES || DEFAULT_SCAN_MAX_BYTES)
  );
  const targetCollection = collectTargets(maxTargets, {
    pumpProgramId: Config.pumpBondingCurveProgramId,
    telemetryPath: args.telemetry ? path.resolve(ROOT, String(args.telemetry)) : null,
    scanMaxBytes
  });
  const targets = targetCollection.targets;
  if (!targets.length) {
    throw new Error('No probe targets found from latest targeted parity report or telemetry.');
  }
  const sensitiveEndpoints = [
    url,
    Config.solanaRpcUrl,
    Config.solanaRpcFallback,
    Config.solanaRpcAccountReadUrl
  ].filter(Boolean);
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
    const context = { config: Config };
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
              context,
              sensitiveEndpoints
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
      scanMaxBytes,
      node: process.version,
      targets,
      targetCollection: {
        telemetryPath: targetCollection.telemetryPath
          ? path.relative(ROOT, targetCollection.telemetryPath)
          : null,
        telemetryScan: targetCollection.telemetryScan
      }
    },
    skippedModes,
    summary: summarizeRows(rows),
    rows
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PATH)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(sanitizeProbeError(error));
    process.exitCode = 1;
  });
}

module.exports = {
  collectTargets,
  forEachRecentJsonlSync,
  redactEndpoint,
  sanitizeProbeError
};
