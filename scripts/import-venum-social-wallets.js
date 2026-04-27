const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(REPO_ROOT, 'agents', 'weRvENum', 'runtime', 'social_wallet_tracker_export.json');
const DEFAULT_OUTPUT = path.join(REPO_ROOT, 'data', 'wallet-watchlists', 'venum-social-wallets.json');

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

function resolveRepoPath(filePath, fallback) {
  const target = filePath || fallback;
  return path.isAbsolute(target) ? target : path.join(REPO_ROOT, target);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function compactHandleList(handles) {
  return Array.from(new Set((handles || [])
    .map((handle) => String(handle || '').trim())
    .filter(Boolean)));
}

function normalizeSolanaWallets(payload, limit) {
  const wallets = [];
  const seen = new Set();

  for (const item of payload.wallets || []) {
    if (String(item.chain || '').toLowerCase() !== 'solana') {
      continue;
    }

    const walletAddress = String(item.wallet || '').trim();
    if (!walletAddress || seen.has(walletAddress)) {
      continue;
    }
    seen.add(walletAddress);

    const handles = compactHandleList(item.handles);
    wallets.push({
      rank: wallets.length + 1,
      walletAddress,
      name: handles[0] || null,
      twitter: handles[0] ? `https://x.com/${handles[0]}` : null,
      telegram: null,
      pfp: null,
      source: 'venum_social_wallet_intel',
      mode: 'watch_only',
      sourceTypes: Array.isArray(item.source_types) ? item.source_types : [],
      xHandles: handles,
      firstSeenAt: item.first_seen_at || null,
      lastSeenAt: item.last_seen_at || null
    });

    if (wallets.length >= limit) {
      break;
    }
  }

  return wallets;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolveRepoPath(args.input, DEFAULT_INPUT);
  const outputPath = resolveRepoPath(args.output, DEFAULT_OUTPUT);
  const limit = Math.max(parseInt(args.limit || '100', 10), 1);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Venum social wallet export not found at ${inputPath}`);
  }

  const payload = readJson(inputPath);
  const wallets = normalizeSolanaWallets(payload, limit);
  const output = {
    source: 'venum_social_wallet_intel',
    mode: 'watch_only',
    importedAt: new Date().toISOString(),
    inputFile: inputPath,
    count: wallets.length,
    evmWalletCount: (payload.wallets || []).filter((item) => String(item.chain || '').toLowerCase() === 'evm').length,
    wallets
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(`Imported ${wallets.length} Solana wallets from Venum social intel`);
  console.log(`Saved watchlist to ${outputPath}`);
  if (output.evmWalletCount > 0) {
    console.log(`Kept ${output.evmWalletCount} EVM wallet breadcrumbs in Venum runtime export only`);
  }
}

try {
  main();
} catch (error) {
  console.error(`Failed to import Venum social wallets: ${error.message}`);
  process.exit(1);
}
