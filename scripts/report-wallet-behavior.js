const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const WALLET_INTEL_DIR = path.join(REPO_ROOT, 'data', 'wallet-intel');
const WALLET_EVENT_DIR = path.join(REPO_ROOT, 'data', 'wallet-events');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'wallet-reports');

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function compact(value, decimals = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(decimals));
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  );
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

function summarizeEventWallet(wallet) {
  return {
    wallet: wallet.wallet,
    label: wallet.classification?.label || 'UNCLASSIFIED',
    confidence: compact(wallet.classification?.confidence, 4),
    reasons: wallet.classification?.reasons || [],
    touches: Number(wallet.touches || 0),
    buys: Number(wallet.buys || 0),
    sells: Number(wallet.sells || 0),
    totalSol: compact(wallet.totalSol, 8),
    preMigrationTouches: Number(wallet.preMigrationTouches || 0),
    postMigrationTouches: Number(wallet.postMigrationTouches || 0),
    earliestTouchSeconds: compact(wallet.earliestTouchSeconds, 3),
    walletProfile: wallet.walletProfile || null,
    recentMints: Array.isArray(wallet.recentMints) ? wallet.recentMints.slice(0, 8) : []
  };
}

function summarizeMintTouches(events, walletLabels = {}) {
  const byMint = new Map();
  for (const event of events) {
    const mint = event.mint;
    if (!mint) continue;
    const existing = byMint.get(mint) || {
      mint,
      symbol: event.symbol || null,
      name: event.name || null,
      touches: 0,
      buys: 0,
      sells: 0,
      wallets: new Set(),
      labels: {},
      totalSol: 0,
      earliestTouchSeconds: null,
      phases: {}
    };

    const label = event.classification?.label || event.walletClassification || walletLabels[event.wallet] || 'UNCLASSIFIED';
    existing.touches += 1;
    existing.buys += event.side === 'buy' ? 1 : 0;
    existing.sells += event.side === 'sell' ? 1 : 0;
    existing.wallets.add(event.wallet);
    existing.labels[label] = (existing.labels[label] || 0) + 1;
    existing.totalSol += Number(event.amount?.sol || 0);
    existing.phases[event.phase || 'unknown'] = (existing.phases[event.phase || 'unknown'] || 0) + 1;
    if (event.timing?.secondsSinceCreate !== null && event.timing?.secondsSinceCreate !== undefined) {
      existing.earliestTouchSeconds = existing.earliestTouchSeconds === null
        ? Number(event.timing.secondsSinceCreate)
        : Math.min(existing.earliestTouchSeconds, Number(event.timing.secondsSinceCreate));
    }
    byMint.set(mint, existing);
  }

  return [...byMint.values()]
    .map((item) => ({
      ...item,
      wallets: [...item.wallets],
      walletCount: item.wallets.size,
      totalSol: compact(item.totalSol, 8),
      earliestTouchSeconds: compact(item.earliestTouchSeconds, 3)
    }))
    .sort((a, b) => b.touches - a.touches || b.walletCount - a.walletCount)
    .slice(0, 40);
}

function buildEventLedgerSummary() {
  const latestPath = path.join(WALLET_EVENT_DIR, 'latest.json');
  const eventsPath = path.join(WALLET_EVENT_DIR, 'events.jsonl');
  const latest = readJson(latestPath, {});
  const events = readJsonl(eventsPath);
  const topWallets = Array.isArray(latest.topWallets) ? latest.topWallets : [];

  const byLabel = countBy(topWallets, (wallet) => wallet.classification?.label || 'UNCLASSIFIED');
  const groups = {
    earlySnipers: topWallets.filter((wallet) => wallet.classification?.label === 'EARLY_SNIPER').map(summarizeEventWallet),
    alphaScalpers: topWallets.filter((wallet) => wallet.classification?.label === 'EARLY_ALPHA_SCALPER').map(summarizeEventWallet),
    convictionWhales: topWallets.filter((wallet) => wallet.classification?.label === 'CONVICTION_WHALE').map(summarizeEventWallet),
    runnerHunters: topWallets.filter((wallet) => wallet.classification?.label === 'RUNNER_HUNTER').map(summarizeEventWallet),
    dumpers: topWallets.filter((wallet) => ['INSIDER_DUMPER', 'DEV_SIDE_WALLET', 'BUNDLE_CLUSTER'].includes(wallet.classification?.label)).map(summarizeEventWallet),
    lateChasers: topWallets.filter((wallet) => wallet.classification?.label === 'LATE_CHASER').map(summarizeEventWallet)
  };

  return {
    latestPath,
    eventsPath,
    latestGeneratedAt: latest.generatedAt || null,
    rawEventCount: events.length,
    walletCount: Number(latest.walletCount || topWallets.length || 0),
    classificationCounts: latest.classificationCounts || byLabel,
    phaseCounts: countBy(events, (event) => event.phase || 'unknown'),
    sideCounts: countBy(events, (event) => event.side || 'unknown'),
    watchedReasonCounts: countBy(events, (event) => event.watchedReason || 'unknown'),
    groups,
    hotMints: summarizeMintTouches(
      events,
      Object.fromEntries(topWallets.map((wallet) => [wallet.wallet, wallet.classification?.label || 'UNCLASSIFIED']))
    )
  };
}

function main() {
  const intelPath = path.join(WALLET_INTEL_DIR, 'latest.json');
  const intel = readJson(intelPath, {});
  const wallets = Array.isArray(intel.topWallets) ? intel.topWallets : [];

  const trusted = wallets.filter((item) => item.behavior?.trustTier === 'TRUSTED');
  const mixed = wallets.filter((item) => item.behavior?.trustTier === 'MIXED');
  const avoid = wallets.filter((item) => item.behavior?.trustTier === 'AVOID');
  const eventLedger = buildEventLedgerSummary();

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
    avoid: summarizeGroup(avoid),
    eventLedger
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
  console.log(`wallet events=${eventLedger.rawEventCount} wallets=${eventLedger.walletCount}`);
  console.log(`earlySnipers=${eventLedger.groups.earlySnipers.length} alphaScalpers=${eventLedger.groups.alphaScalpers.length} convictionWhales=${eventLedger.groups.convictionWhales.length} dumpers=${eventLedger.groups.dumpers.length}`);
}

try {
  main();
} catch (error) {
  console.error(`Failed to build wallet behavior report: ${error.message}`);
  process.exit(1);
}
