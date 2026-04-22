const fs = require('fs');
const path = require('path');

const WALLET_INTEL_DIR = path.join(__dirname, '..', 'data', 'wallet-intel');
const OUTPUT_DIR = path.join(__dirname, '..', 'data', 'wallet-reports');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeGroup(wallets) {
  return wallets.map((wallet) => ({
    walletAddress: wallet.walletAddress,
    name: wallet.name || null,
    rank: wallet.rank || null,
    score: wallet.score,
    profile: wallet.behavior?.behaviorProfile || null,
    flags: wallet.behavior?.flags || [],
    metrics: wallet.behavior?.metrics || {}
  }));
}

function main() {
  const intelPath = path.join(WALLET_INTEL_DIR, 'latest.json');
  if (!fs.existsSync(intelPath)) {
    throw new Error('Could not find wallet intel. Run build:wallet-intel first.');
  }

  const intel = readJson(intelPath);
  const wallets = Array.isArray(intel.topWallets) ? intel.topWallets : [];

  const trusted = wallets.filter((item) => item.behavior?.trustTier === 'TRUSTED');
  const mixed = wallets.filter((item) => item.behavior?.trustTier === 'MIXED');
  const avoid = wallets.filter((item) => item.behavior?.trustTier === 'AVOID');

  const payload = {
    source: 'wallet_behavior_report',
    generatedAt: new Date().toISOString(),
    walletIntelFile: intelPath,
    counts: {
      trusted: trusted.length,
      mixed: mixed.length,
      avoid: avoid.length
    },
    trusted: summarizeGroup(trusted),
    mixed: summarizeGroup(mixed),
    avoid: summarizeGroup(avoid)
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `wallet-behavior-report-${stamp}.json`);
  const latestPath = path.join(OUTPUT_DIR, 'latest.json');

  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`Saved wallet behavior report to ${outputPath}`);
  console.log(`Updated latest wallet behavior report at ${latestPath}`);
  console.log(`trusted=${trusted.length} mixed=${mixed.length} avoid=${avoid.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to build wallet behavior report: ${error.message}`);
  process.exit(1);
}
