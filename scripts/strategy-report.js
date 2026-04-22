const fs = require('fs');
const path = require('path');
const StrategyLedger = require('../src/lib/strategy-ledger');

function resolveLatestLedger(logDir) {
  const candidates = fs.readdirSync(logDir)
    .filter((name) => name.startsWith('strategy-ledger-') && name.endsWith('.jsonl'))
    .map((name) => ({
      name,
      fullPath: path.join(logDir, name),
      stat: fs.statSync(path.join(logDir, name))
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);

  return candidates[0]?.fullPath || null;
}

function printSummary(summary, filePath) {
  console.log(`Strategy Ledger Report`);
  console.log(`File: ${filePath}`);
  console.log(`Sessions: ${summary.totalSessions}`);
  console.log(`Entries: ${summary.totalEntries}`);
  console.log(`Exits: ${summary.totalExits}`);
  console.log(`Realized PnL: ${summary.totalRealizedPnlSol.toFixed(4)} SOL`);

  const strategies = Object.entries(summary.strategies || {});
  if (strategies.length === 0) {
    console.log(`No strategy data found.`);
    return;
  }

  console.log(``);
  console.log(`By Strategy:`);
  strategies
    .sort((a, b) => b[1].realizedPnlSol - a[1].realizedPnlSol)
    .forEach(([strategy, bucket]) => {
      console.log(
        `- ${strategy}: entries=${bucket.entries}, exits=${bucket.exits}, wins=${bucket.wins}, losses=${bucket.losses}, flats=${bucket.flats}, winRate=${(bucket.winRate * 100).toFixed(1)}%, pnl=${bucket.realizedPnlSol.toFixed(4)} SOL`
      );
    });
}

function main() {
  const providedPath = process.argv[2];
  const logDir = path.join(process.cwd(), 'run-logs');
  const ledgerPath = providedPath || resolveLatestLedger(logDir);

  if (!ledgerPath || !fs.existsSync(ledgerPath)) {
    console.error('No strategy ledger file found.');
    process.exit(1);
  }

  const events = StrategyLedger.readEvents(ledgerPath);
  const summary = StrategyLedger.summarizeEvents(events);
  printSummary(summary, ledgerPath);
}

main();
