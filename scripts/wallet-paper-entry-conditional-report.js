const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STABILITY_PATH = path.join(ROOT, 'data', 'reports', 'wallet-timeblocked-stability-latest.json');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'wallet-paper-entry-conditional');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'wallet-paper-entry-conditional-latest.json');

const POSITIVE_OUTCOMES = new Set(['MIGRATED_OR_COMPLETED', 'NEAR_RUNNER_95', 'NEAR_MIGRATION_85', 'PAPER_WIN']);

function readJson(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function compact(value, decimals = 6) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(decimals)) : null;
}

function pct(part, total) {
  return total > 0 ? Number((part / total).toFixed(4)) : null;
}

function summarize(label, rows) {
  const uniqueMints = new Map(rows.map((row) => [row.mint, row]));
  const mintRows = Array.from(uniqueMints.values());
  const paperWins = mintRows.filter((row) => row.outcome === 'PAPER_WIN').length;
  const paperLosses = mintRows.filter((row) => row.outcome === 'PAPER_LOSS').length;
  const positiveCount = mintRows.filter((row) => POSITIVE_OUTCOMES.has(row.outcome)).length;
  const pnl = mintRows.reduce((sum, row) => sum + Number(row.paperPnlSol || 0), 0);
  return {
    label,
    walletMintRows: rows.length,
    uniqueEnteredMints: mintRows.length,
    positiveCount,
    positiveRate: pct(positiveCount, mintRows.length),
    paperWins,
    paperLosses,
    paperWinRate: pct(paperWins, paperWins + paperLosses),
    paperPnlSol: compact(pnl),
    averagePaperPnlSol: compact(mintRows.length ? pnl / mintRows.length : null),
    tinyDenominatorWarning: mintRows.length < 10 || (paperWins + paperLosses) < 5
  };
}

function buildReport(stability) {
  const enteredRows = (stability?.rows || []).filter((row) => Number(row.paperEntries || 0) > 0);
  const byTier = {};
  for (const tier of ['TRUST_REVIEW', 'PROFITABLE_NEEDS_FIRST_TOUCH_EVIDENCE', 'WATCH_REVIEW', 'AVOID_REVIEW', 'HOLD']) {
    byTier[tier] = summarize(tier, enteredRows.filter((row) => row.reviewTierAtRun === tier));
  }

  const wallets = Array.from(new Set(enteredRows.map((row) => row.canonicalWallet))).map((wallet) => {
    const rows = enteredRows.filter((row) => row.canonicalWallet === wallet);
    return {
      canonicalWallet: wallet,
      evidenceTier: rows[0]?.evidenceTier || null,
      reviewTiersSeen: Array.from(new Set(rows.map((row) => row.reviewTierAtRun))).sort(),
      ...summarize(wallet, rows),
      sampleMints: Array.from(new Map(rows.map((row) => [row.mint, row])).values()).slice(0, 12).map((row) => ({
        mint: row.mint,
        symbol: row.symbol,
        reviewTierAtRun: row.reviewTierAtRun,
        outcome: row.outcome,
        paperPnlSol: row.paperPnlSol
      }))
    };
  }).sort((a, b) => {
    if (Number(b.paperPnlSol || 0) !== Number(a.paperPnlSol || 0)) {
      return Number(b.paperPnlSol || 0) - Number(a.paperPnlSol || 0);
    }
    return Number(b.uniqueEnteredMints || 0) - Number(a.uniqueEnteredMints || 0);
  });

  return {
    summary: {
      enteredWalletMintRows: enteredRows.length,
      uniqueEnteredMints: new Set(enteredRows.map((row) => row.mint)).size,
      walletsWithEnteredMints: wallets.length
    },
    byTier,
    topProfitableWallets: wallets.filter((wallet) => wallet.paperPnlSol > 0).slice(0, 20),
    worstWallets: wallets.slice().sort((a, b) => Number(a.paperPnlSol || 0) - Number(b.paperPnlSol || 0)).slice(0, 20),
    wallets,
    enteredRows
  };
}

function main() {
  const stability = readJson(STABILITY_PATH, {});
  const generatedAt = new Date().toISOString();
  const report = buildReport(stability);
  const payload = {
    generatedAt,
    mode: 'report_only_wallet_paper_entry_conditional',
    sources: {
      stabilityGeneratedAt: stability.generatedAt || null
    },
    note: 'Report-only paper-entry-conditional wallet view. This measures what happened on wallet-touched mints Spectre actually entered, separating monetizable behavior from mere downstream movement.',
    ...report
  };
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.join(OUTPUT_DIR, `wallet-paper-entry-conditional-${stamp}.json`);
  writeJson(reportPath, payload);
  writeJson(LATEST_PATH, payload);
  console.log(`Wrote wallet paper-entry conditional report: ${reportPath}`);
  console.log(`Wrote latest wallet paper-entry conditional report: ${LATEST_PATH}`);
  console.log(`enteredRows=${payload.summary.enteredWalletMintRows} uniqueMints=${payload.summary.uniqueEnteredMints}`);
}

main();
