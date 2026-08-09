'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  buildSpecimen,
  buildSpecimenForMint,
  labelContinuation,
  normalizeSymbol,
  scoreContinuation,
  summarizeRickOverlap
} = require('./continuation-specimen-report');
const {
  gradeCandidate,
  selectMiloPicks
} = require('../src/lib/milo-readonly-scout');
const {
  MiloReadonlyProvider,
  describeError
} = require('../src/lib/milo-readonly-provider');

const REPO_ROOT = path.join(__dirname, '..');
const LOCAL_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'milo-scout.local.json');
const EXAMPLE_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'milo-scout.example.json');
const DEFAULT_WALLET_EVIDENCE_PATH = path.join(REPO_ROOT, 'data', 'reports', 'kolscan-wallet-evidence-latest.json');
const LATEST_OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'reports', 'milo-scout-latest.json');
const OUTPUT_DIR = path.join(REPO_ROOT, 'data', 'milo', 'scouts');
const RICK_WEIGHTS = Object.freeze({
  runnersReport: 4,
  trendingDex: 4,
  burpLeaderboard: 3,
  trendingPump: 2
});

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    index += 1;
  }
  return result;
}

function readJson(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function resolveRepoPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(REPO_ROOT, filePath);
}

function loadConfig() {
  const sourcePath = fs.existsSync(LOCAL_CONFIG_PATH) ? LOCAL_CONFIG_PATH : EXAMPLE_CONFIG_PATH;
  const config = readJson(sourcePath, {});
  if (config.mode !== 'READ_ONLY') {
    throw new Error('Milo scout configuration must use READ_ONLY mode');
  }
  return { config, sourcePath };
}

function rickPriority(item = {}) {
  const reportScore = (item.reportTypes || [])
    .reduce((total, reportType) => total + Number(RICK_WEIGHTS[reportType] || 1), 0);
  const lastSeenMs = Date.parse(item.lastSeen || 0);
  const ageHours = Number.isFinite(lastSeenMs) && lastSeenMs > 0
    ? Math.max(0, (Date.now() - lastSeenMs) / 3_600_000)
    : 999;
  const recency = Math.max(0, 8 - Math.min(ageHours, 8));
  return reportScore * 3
    + Number(item.socialOverlapScore || 0) * 2
    + Number(item.mentions || 0)
    + recency;
}

function chooseRickRows(rickContext, args, maxSymbols) {
  const explicitMints = String(args.mints || '')
    .split(',')
    .map((mint) => mint.trim())
    .filter(Boolean);
  if (explicitMints.length > 0) {
    return Array.from(new Set(explicitMints)).map((exactMint) => ({
      exactMint,
      symbol: null,
      symbolKey: null,
      mentions: 1,
      reportTypes: [],
      socialOverlapScore: 0,
      identitySource: 'cli_exact_mint'
    }));
  }

  const explicitSymbols = String(args.symbols || args._.join(',') || '')
    .split(',')
    .map(normalizeSymbol)
    .filter(Boolean);
  const rows = Array.isArray(rickContext?.tokenOverlap) ? rickContext.tokenOverlap : [];
  if (explicitSymbols.length > 0) {
    const bySymbol = new Map(rows.map((row) => [normalizeSymbol(row.symbolKey || row.symbol), row]));
    return Array.from(new Set(explicitSymbols)).map((symbol) => bySymbol.get(symbol) || {
      symbol,
      symbolKey: symbol,
      mentions: 0,
      reportTypes: [],
      socialOverlapScore: 0
    });
  }
  const exactMintRows = (Array.isArray(rickContext?.messages) ? rickContext.messages : [])
    .flatMap((message) => (message.mintCandidates || []).map((exactMint) => {
      const symbolMatch = String(message.text || '').match(/\(\$([a-zA-Z0-9]+)\)/);
      const symbol = normalizeSymbol(symbolMatch?.[1]);
      return {
        exactMint,
        symbol: symbol || null,
        symbolKey: symbol || null,
        mentions: 1,
        reportTypes: message.reportType ? [message.reportType] : [],
        socialOverlapScore: 0,
        firstSeen: message.date || null,
        lastSeen: message.date || null,
        lines: [String(message.text || '').split(/\r?\n/)[0]].filter(Boolean),
        identitySource: 'rick_exact_mint'
      };
    }));
  const exactSymbols = new Set(exactMintRows.map((row) => row.symbolKey).filter(Boolean));
  const rankedSymbols = [...rows]
    .sort((left, right) => rickPriority(right) - rickPriority(left))
    .filter((row) => !exactSymbols.has(normalizeSymbol(row.symbolKey || row.symbol)));
  return [...exactMintRows, ...rankedSymbols]
    .slice(0, Math.max(1, Number(maxSymbols || 16)));
}

function chooseWalletEvidenceRows(walletEvidence, config = {}, nowMs = Date.now()) {
  const maxRows = Math.max(0, Number(config.maxWalletEvidenceMints || 5));
  const maxAgeMinutes = Math.max(1, Number(config.walletEvidenceMaxAgeMinutes || 360));
  return (Array.isArray(walletEvidence?.freshWalletFlow) ? walletEvidence.freshWalletFlow : [])
    .filter((row) => row.walletAuditEligible === true)
    .filter((row) => {
      const atMs = Date.parse(row.latestBuyAt || 0);
      return Number.isFinite(atMs)
        && atMs <= nowMs
        && nowMs - atMs <= maxAgeMinutes * 60_000;
    })
    .slice(0, maxRows)
    .map((row) => ({
      exactMint: row.mint,
      symbol: null,
      symbolKey: null,
      mentions: 0,
      reportTypes: [],
      socialOverlapScore: 0,
      identitySource: 'helius_wallet_flow',
      walletEvidence: {
        latestBuyAt: row.latestBuyAt,
        ageMinutes: row.ageMinutes,
        qualifiedWalletCount: row.qualifiedWalletCount,
        gradeAWalletCount: row.gradeAWalletCount,
        qualifiedWallets: row.qualifiedWallets
      }
    }));
}

function isExplicitScoutRequest(args = {}) {
  return Boolean(args.mints || args.symbols || (Array.isArray(args._) && args._.length > 0));
}

function currentRickRowForSymbol(rickContext, symbol) {
  const target = normalizeSymbol(symbol);
  if (!target) return null;
  return (Array.isArray(rickContext?.tokenOverlap) ? rickContext.tokenOverlap : [])
    .find((row) => normalizeSymbol(row.symbolKey || row.symbol) === target) || null;
}

function applyWalletRickOverlapGate(candidate) {
  if (!candidate?.specimen?.walletEvidence) return candidate;
  const reports = Array.isArray(candidate.specimen.rickOverlap?.reportTypes)
    ? candidate.specimen.rickOverlap.reportTypes
    : [];
  candidate.walletEvidence = candidate.specimen.walletEvidence;
  candidate.provenance = {
    candidateSource: 'helius_wallet_flow',
    walletEvidenceQualified: true,
    currentRickOverlap: reports.length > 0,
    currentRickReportTypes: reports
  };
  if (reports.length === 0 && ['A', 'B'].includes(candidate.assessment.grade)) {
    candidate.assessment = {
      ...candidate.assessment,
      grade: 'WATCH',
      sizeUsd: null,
      cautions: Array.from(new Set([
        ...(candidate.assessment.cautions || []),
        'QUALIFIED_WALLET_FLOW_WITHOUT_CURRENT_RICK_OVERLAP'
      ]))
    };
  } else if (reports.length > 0) {
    candidate.assessment.reasons = Array.from(new Set([
      ...(candidate.assessment.reasons || []),
      'QUALIFIED_WALLET_FLOW_AND_CURRENT_RICK_OVERLAP'
    ]));
  }
  return candidate;
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return output;
}

function emptyDossierIndex() {
  return {
    bySymbol: new Map(),
    stats: {
      filesRead: 0,
      rowsScanned: 0,
      rowsMatched: 0,
      rowsStored: 0,
      rowsDroppedByCap: 0,
      maxPerSymbol: 300
    }
  };
}

function pickInstruction(myPicks) {
  if (!myPicks.length) {
    return 'No A/B candidates passed the read-only safety, activity, liquidity, and quote checks. Keep Milo idle.';
  }
  const lines = myPicks.map((pick) => (
    `${pick.symbol} | ${pick.mint} | grade ${pick.grade} | max test ticket $${pick.sizeUsd}`
  ));
  return [
    'Use only these exact mint addresses in Milo My Picks for this scout epoch:',
    ...lines,
    'Do not substitute same-symbol tokens. Do not trade WATCH or REJECT rows. Re-run the scout before changing the list.'
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { config, sourcePath } = loadConfig();
  const rickContextPath = resolveRepoPath(args.rickContext || config.rickContextPath);
  const rickContext = readJson(rickContextPath, null);
  if (!rickContext) throw new Error('Rick context is unavailable; refresh it before scouting');
  const walletEvidencePath = resolveRepoPath(
    args.walletEvidence || config.walletEvidencePath || DEFAULT_WALLET_EVIDENCE_PATH
  );
  const walletEvidence = readJson(walletEvidencePath, null);

  const provider = new MiloReadonlyProvider();
  const rickRows = chooseRickRows(rickContext, args, args.maxSymbols || config.maxSymbols);
  const walletRows = isExplicitScoutRequest(args)
    ? []
    : chooseWalletEvidenceRows(walletEvidence, config);
  const scoutRows = [...walletRows, ...rickRows]
    .filter((row, index, rows) => {
      if (!row.exactMint) return true;
      return rows.findIndex((other) => other.exactMint === row.exactMint) === index;
    })
    .slice(0, Math.max(1, Number(args.maxSymbols || config.maxSymbols || 16)));
  const dossierIndex = emptyDossierIndex();
  const nowMs = Date.now();
  const specimens = [];

  for (const rickRow of scoutRows) {
    const symbol = normalizeSymbol(rickRow.symbolKey || rickRow.symbol) || 'EXACTMINT';
    try {
      const overlap = summarizeRickOverlap(rickRow);
      const specimen = rickRow.exactMint
        ? await buildSpecimenForMint(rickRow.exactMint, overlap, dossierIndex, nowMs)
        : await buildSpecimen(symbol, overlap, dossierIndex, nowMs);
      if (rickRow.walletEvidence) {
        const currentRickRow = currentRickRowForSymbol(rickContext, specimen.symbol);
        specimen.rickOverlap = summarizeRickOverlap(currentRickRow || {});
        specimen.walletEvidence = rickRow.walletEvidence;
        specimen.candidateSource = rickRow.identitySource;
        const rescored = scoreContinuation(specimen, specimen.internalContext || {});
        specimen.continuationScore = rescored.score;
        specimen.reasons = rescored.reasons;
        specimen.riskFlags = rescored.riskFlags;
        specimen.label = labelContinuation(specimen, rescored);
      }
      specimens.push(specimen);
    } catch (error) {
      specimens.push({
        symbol,
        status: 'error',
        label: 'continuation_rejected:fetch_error',
        continuationScore: 0,
        riskFlags: ['fetch_error'],
        error: describeError(error)
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const resolved = specimens
    .filter((specimen) => specimen.status === 'resolved' && specimen.mint)
    .sort((left, right) => Number(right.continuationScore || 0) - Number(left.continuationScore || 0))
    .slice(0, Math.max(1, Number(config.maxEnrichedCandidates || 10)));

  const basics = await mapLimit(resolved, 2, async (specimen) => {
    const [onchain, activity] = await Promise.all([
      provider.getMintOnchain(specimen.mint),
      specimen.primaryPairAddress
        ? provider.getPoolActivity(specimen.primaryPairAddress, {
          windowMinutes: config.activityWindowMinutes,
          limit: config.enhancedTransactionLimit,
          nowMs
        })
        : Promise.resolve({ coverage: 'missing', reason: 'PAIR_ADDRESS_MISSING' })
    ]);
    return { specimen, onchain, activity };
  });

  const candidates = [];
  for (const basic of basics) {
    const quotes = [];
    for (const sizeUsd of config.quoteSizesUsd || [10, 15]) {
      quotes.push(await provider.getJupiterQuote(basic.specimen.mint, sizeUsd));
    }
    const candidate = {
      symbol: basic.specimen.symbol,
      mint: basic.specimen.mint,
      specimen: basic.specimen,
      onchain: basic.onchain,
      activity: basic.activity,
      quotes
    };
    candidate.assessment = gradeCandidate(candidate, config.policy);
    candidates.push(applyWalletRickOverlapGate(candidate));
  }

  const myPicks = selectMiloPicks(candidates, config.maxPicks);
  const generatedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    generatedAt,
    mode: 'READ_ONLY',
    purpose: 'Spectre research and audit support for Milo; no execution, signing, or order submission',
    executionGuard: {
      spectreTradingStarted: false,
      transactionBuilt: false,
      transactionSigned: false,
      orderSubmitted: false
    },
    strategyName: config.strategyName || 'Pocket Runner Scalper',
    miloWalletAddress: config.miloWalletAddress || null,
    sources: {
      config: path.relative(REPO_ROOT, sourcePath),
      rickContext: path.relative(REPO_ROOT, rickContextPath),
      rickGeneratedAt: rickContext.generatedAt || null,
      walletEvidence: walletEvidence ? path.relative(REPO_ROOT, walletEvidencePath) : null,
      walletEvidenceGeneratedAt: walletEvidence?.generatedAt || null,
      dexIdentityAndMarket: 'DexScreener',
      accountSafetyAndActivity: 'Helius/Solana RPC',
      executableQuoteProbe: 'Jupiter Ultra order quote without taker'
    },
    capabilities: provider.capabilities(),
    summary: {
      rickRowsAvailable: rickRows.length,
      rickSymbolsScouted: scoutRows.filter((row) => !row.walletEvidence).length,
      walletFlowMintsScouted: walletRows.length,
      candidateInputsScouted: scoutRows.length,
      identitiesResolved: specimens.filter((specimen) => specimen.status === 'resolved').length,
      candidatesEnriched: candidates.length,
      grades: candidates.reduce((counts, candidate) => {
        const grade = candidate.assessment.grade;
        counts[grade] = (counts[grade] || 0) + 1;
        return counts;
      }, {}),
      miloPickCount: myPicks.length
    },
    myPicks,
    miloInstruction: pickInstruction(myPicks),
    candidates,
    unresolvedSpecimens: specimens.filter((specimen) => specimen.status !== 'resolved')
  };

  const timestampedOutputPath = path.join(
    OUTPUT_DIR,
    `milo-scout-${generatedAt.replace(/[:.]/g, '-')}.json`
  );
  writeJson(timestampedOutputPath, report);
  writeJson(LATEST_OUTPUT_PATH, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('Milo Read-Only Scout');
  console.log('====================');
  console.log(`Rick symbols=${report.summary.rickSymbolsScouted} wallet-flow mints=${report.summary.walletFlowMintsScouted} resolved=${report.summary.identitiesResolved} enriched=${report.summary.candidatesEnriched}`);
  console.log(`Grades=${JSON.stringify(report.summary.grades)} picks=${myPicks.length}`);
  for (const candidate of candidates) {
    console.log(`${candidate.assessment.grade.padEnd(6)} ${String(candidate.symbol || 'UNKNOWN').padEnd(12)} score=${candidate.assessment.adjustedScore} mint=${candidate.mint}`);
  }
  console.log('\nMilo handoff');
  console.log('------------');
  console.log(report.miloInstruction);
  console.log(`\nReport: ${LATEST_OUTPUT_PATH}`);
}

if (require.main === module) {
  main().catch((error) => {
    const safe = describeError(error);
    console.error(`milo-scout failed (${safe.type}${safe.status ? ` status=${safe.status}` : ''})`);
    process.exitCode = 1;
  });
}

module.exports = {
  applyWalletRickOverlapGate,
  chooseWalletEvidenceRows,
  chooseRickRows,
  currentRickRowForSymbol,
  isExplicitScoutRequest,
  loadConfig,
  main,
  pickInstruction,
  rickPriority
};
