'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  MiloReadonlyProvider,
  SOL_MINT,
  describeError
} = require('../src/lib/milo-readonly-provider');

const REPO_ROOT = path.join(__dirname, '..');
const LOCAL_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'milo-scout.local.json');
const LATEST_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'milo-wallet-latest.json');
const LEDGER_PATH = path.join(REPO_ROOT, 'data', 'milo', 'wallet-snapshots.jsonl');

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function toBalanceMap(snapshot = {}) {
  const map = new Map();
  if (snapshot.native?.balance !== null && snapshot.native?.balance !== undefined) {
    map.set(SOL_MINT, {
      mint: SOL_MINT,
      symbol: 'SOL',
      balance: Number(snapshot.native.balance)
    });
  }
  for (const holding of snapshot.holdings || []) {
    map.set(holding.mint, {
      mint: holding.mint,
      symbol: holding.symbol || null,
      balance: Number(holding.balance || 0)
    });
  }
  return map;
}

function diffSnapshots(previous, current) {
  if (!previous?.snapshot) return { baseline: true, balanceChanges: [], newTransactions: [] };
  const before = toBalanceMap(previous.snapshot);
  const after = toBalanceMap(current);
  const mints = new Set([...before.keys(), ...after.keys()]);
  const balanceChanges = Array.from(mints).map((mint) => {
    const oldRow = before.get(mint) || { mint, symbol: null, balance: 0 };
    const newRow = after.get(mint) || { mint, symbol: null, balance: 0 };
    return {
      mint,
      symbol: newRow.symbol || oldRow.symbol,
      previousBalance: oldRow.balance,
      currentBalance: newRow.balance,
      delta: Number((newRow.balance - oldRow.balance).toFixed(9))
    };
  }).filter((row) => row.delta !== 0);

  const previousSignatures = new Set(
    previous.snapshot?.enhancedHistory?.recentTransactions?.map((transaction) => transaction.signature).filter(Boolean) || []
  );
  const newTransactions = (current.enhancedHistory?.recentTransactions || [])
    .filter((transaction) => transaction.signature && !previousSignatures.has(transaction.signature));
  return { baseline: false, balanceChanges, newTransactions };
}

async function main() {
  const config = readJson(LOCAL_CONFIG_PATH, null);
  if (!config?.miloWalletAddress) {
    throw new Error('Local Milo wallet configuration is missing');
  }
  if (config.mode !== 'READ_ONLY') {
    throw new Error('Milo wallet observer requires READ_ONLY mode');
  }

  const provider = new MiloReadonlyProvider();
  const previous = readJson(LATEST_OUTPUT_PATH, null);
  const snapshot = await provider.getWalletSnapshot(config.miloWalletAddress, {
    enhancedTransactionLimit: config.enhancedTransactionLimit
  });
  const changes = diffSnapshots(previous, snapshot);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY',
    executionGuard: {
      transactionBuilt: false,
      transactionSigned: false,
      orderSubmitted: false
    },
    strategyName: config.strategyName || 'Pocket Runner Scalper',
    snapshot,
    changes
  };

  writeJson(LATEST_OUTPUT_PATH, report);
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.appendFileSync(LEDGER_PATH, `${JSON.stringify(report)}\n`, 'utf8');

  console.log('Milo Wallet Observer (read-only)');
  console.log('================================');
  console.log(`Wallet: ${snapshot.walletAddress}`);
  console.log(`SOL: ${snapshot.native?.balance ?? 'unknown'}`);
  console.log(`Token holdings: ${snapshot.holdings?.length || 0}`);
  console.log(`New public transactions: ${changes.newTransactions.length}`);
  console.log(`Balance changes: ${changes.balanceChanges.length}`);
  for (const change of changes.balanceChanges) {
    console.log(`  ${change.symbol || change.mint}: ${change.delta >= 0 ? '+' : ''}${change.delta}`);
  }
  console.log(`Report: ${LATEST_OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    const safe = describeError(error);
    console.error(`milo-wallet-observer failed (${safe.type}${safe.status ? ` status=${safe.status}` : ''})`);
    process.exitCode = 1;
  });
}

module.exports = {
  diffSnapshots,
  main,
  toBalanceMap
};
