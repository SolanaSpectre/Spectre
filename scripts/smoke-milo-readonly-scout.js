'use strict';

const assert = require('assert');
const {
  gradeCandidate,
  selectMiloPicks,
  summarizeHolderConcentration,
  summarizeSignatures
} = require('../src/lib/milo-readonly-scout');
const {
  describeError,
  parseMintAccount,
  validatePublicKey
} = require('../src/lib/milo-readonly-provider');
const { diffSnapshots } = require('./milo-wallet-observer');
const {
  applyWalletRickOverlapGate,
  chooseWalletEvidenceRows
} = require('./milo-scout');

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function candidate(overrides = {}) {
  const base = {
    symbol: 'BONK',
    mint: MINT,
    specimen: {
      status: 'resolved',
      mint: MINT,
      symbol: 'BONK',
      symbolCollision: false,
      continuationScore: 75,
      liquidityUsd: 100_000,
      reasons: ['liquidity_depth'],
      riskFlags: [],
      rickOverlap: { reportTypes: ['runnersReport', 'trendingDex'] }
    },
    onchain: {
      coverage: 'available',
      mint: { mintAuthority: null, freezeAuthority: null, hasTransferHook: false },
      holders: { top10Pct: 30 }
    },
    activity: {
      coverage: 'available',
      signatures: { recentSuccessfulTransactions: 12 },
      enhanced: { uniqueFeePayers: 6 }
    },
    quotes: [
      { available: true, sizeUsd: 10, priceImpactPct: 0.2 },
      { available: true, sizeUsd: 15, priceImpactPct: 0.4 }
    ]
  };
  return {
    ...base,
    ...overrides,
    specimen: { ...base.specimen, ...(overrides.specimen || {}) },
    onchain: { ...base.onchain, ...(overrides.onchain || {}) },
    activity: { ...base.activity, ...(overrides.activity || {}) }
  };
}

function run() {
  const a = candidate();
  a.assessment = gradeCandidate(a);
  assert.strictEqual(a.assessment.grade, 'A');
  assert.strictEqual(a.assessment.sizeUsd, 15);

  const missingCoverage = candidate({ onchain: { coverage: 'missing', mint: null } });
  missingCoverage.assessment = gradeCandidate(missingCoverage);
  assert.strictEqual(missingCoverage.assessment.grade, 'WATCH');
  assert(missingCoverage.assessment.cautions.includes('ONCHAIN_SAFETY_COVERAGE_MISSING'));

  const frozen = candidate({
    onchain: {
      coverage: 'available',
      mint: { mintAuthority: null, freezeAuthority: 'FrozenAuthority', hasTransferHook: false },
      holders: { top10Pct: 30 }
    }
  });
  frozen.assessment = gradeCandidate(frozen);
  assert.strictEqual(frozen.assessment.grade, 'REJECT');
  assert(frozen.assessment.blockers.includes('FREEZE_AUTHORITY_PRESENT'));

  const verticalChase = candidate({ specimen: { riskFlags: ['late_vertical_chase'] } });
  verticalChase.assessment = gradeCandidate(verticalChase);
  assert.strictEqual(verticalChase.assessment.grade, 'WATCH');

  const fallingKnife = candidate({ specimen: { riskFlags: ['negative_one_hour'] } });
  fallingKnife.assessment = gradeCandidate(fallingKnife);
  assert.strictEqual(fallingKnife.assessment.grade, 'WATCH');

  const ambiguousSymbol = candidate({
    specimen: {
      identitySource: 'symbol_search',
      collision: { unresolved: true, exactActiveMintCount: 2 }
    }
  });
  ambiguousSymbol.assessment = gradeCandidate(ambiguousSymbol);
  assert.strictEqual(ambiguousSymbol.assessment.grade, 'REJECT');
  assert(ambiguousSymbol.assessment.blockers.includes('SYMBOL_COLLISION'));

  const exactMintIdentity = candidate({
    specimen: {
      identitySource: 'exact_mint',
      collision: { unresolved: true, exactActiveMintCount: 2 }
    }
  });
  exactMintIdentity.assessment = gradeCandidate(exactMintIdentity);
  assert.strictEqual(exactMintIdentity.assessment.grade, 'A');

  const duplicate = candidate();
  duplicate.assessment = { ...a.assessment, grade: 'B', adjustedScore: 70 };
  const picks = selectMiloPicks([duplicate, a], 5);
  assert.strictEqual(picks.length, 1);
  assert.strictEqual(picks[0].grade, 'A');

  const walletRows = chooseWalletEvidenceRows({
    freshWalletFlow: [{
      mint: MINT,
      walletAuditEligible: true,
      latestBuyAt: new Date().toISOString(),
      ageMinutes: 1,
      qualifiedWalletCount: 2,
      gradeAWalletCount: 0,
      qualifiedWallets: []
    }]
  }, { maxWalletEvidenceMints: 5, walletEvidenceMaxAgeMinutes: 360 });
  assert.strictEqual(walletRows.length, 1);
  assert.strictEqual(walletRows[0].identitySource, 'helius_wallet_flow');

  const noRick = candidate({
    specimen: {
      walletEvidence: { qualifiedWalletCount: 2 },
      rickOverlap: { reportTypes: [] }
    }
  });
  noRick.assessment = gradeCandidate(noRick);
  applyWalletRickOverlapGate(noRick);
  assert.strictEqual(noRick.assessment.grade, 'WATCH');
  assert(noRick.assessment.cautions.includes('QUALIFIED_WALLET_FLOW_WITHOUT_CURRENT_RICK_OVERLAP'));

  const withRick = candidate({
    specimen: {
      walletEvidence: { qualifiedWalletCount: 2 },
      rickOverlap: { reportTypes: ['runnersReport'] }
    }
  });
  withRick.assessment = gradeCandidate(withRick);
  applyWalletRickOverlapGate(withRick);
  assert.strictEqual(withRick.assessment.grade, 'A');
  assert(withRick.assessment.reasons.includes('QUALIFIED_WALLET_FLOW_AND_CURRENT_RICK_OVERLAP'));

  const concentration = summarizeHolderConcentration([
    { amount: '200' },
    { amount: '100' },
    { amount: '50' }
  ], '1000');
  assert.strictEqual(concentration.top1Pct, 20);
  assert.strictEqual(concentration.top5Pct, 35);

  const nowMs = 2_000_000;
  const signatureSummary = summarizeSignatures([
    { blockTime: 1990, err: null },
    { blockTime: 1800, err: null }
  ], nowMs, 1);
  assert.strictEqual(signatureSummary.recentSuccessfulTransactions, 1);

  const parsedMint = parseMintAccount({
    value: {
      owner: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      data: {
        parsed: {
          info: {
            decimals: 6,
            mintAuthority: null,
            freezeAuthority: null,
            extensions: [{ extension: 'transferHook' }]
          }
        }
      }
    }
  });
  assert.strictEqual(parsedMint.isToken2022, true);
  assert.strictEqual(parsedMint.hasTransferHook, true);

  const hostileError = new Error('https://mainnet.helius-rpc.com/?api-key=DO_NOT_LEAK');
  hostileError.name = 'FetchError';
  hostileError.code = 'ETIMEDOUT';
  hostileError.response = { status: 401 };
  const safe = JSON.stringify(describeError(hostileError));
  assert(!safe.includes('DO_NOT_LEAK'));
  assert(!safe.includes('helius-rpc'));
  assert.strictEqual(JSON.parse(safe).status, 401);

  assert.strictEqual(validatePublicKey(MINT), MINT);
  assert.throws(() => validatePublicKey('not-a-wallet'), /Configured public address is invalid/);

  const rpcCalls = [];
  const { MiloReadonlyProvider } = require('../src/lib/milo-readonly-provider');
  const provider = new MiloReadonlyProvider({ rpcUrl: 'https://example.invalid' });
  provider.rpc = async (method, params) => {
    rpcCalls.push({ method, params });
    if (method === 'getSignaturesForAddress') return [];
    return null;
  };
  provider.getEnhancedTransactions = async () => [];
  return provider.getPoolActivity(MINT, { limit: 12 }).then(() => {
    const signatureCall = rpcCalls.find((call) => call.method === 'getSignaturesForAddress');
    assert.deepStrictEqual(signatureCall.params, [MINT, { limit: 12, commitment: 'confirmed' }]);

    const walletDiff = diffSnapshots({
      snapshot: {
        native: { balance: 1 },
        holdings: [{ mint: MINT, symbol: 'BONK', balance: 100 }],
        enhancedHistory: { recentTransactions: [{ signature: 'old' }] }
      }
    }, {
      native: { balance: 0.9 },
      holdings: [{ mint: MINT, symbol: 'BONK', balance: 120 }],
      enhancedHistory: { recentTransactions: [{ signature: 'new' }, { signature: 'old' }] }
    });
    assert.strictEqual(walletDiff.balanceChanges.length, 2);
    assert.strictEqual(walletDiff.newTransactions.length, 1);

    console.log('milo read-only scout smoke passed');
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
