'use strict';

const assert = require('assert');
const {
  buildFreshWalletFlow,
  exTop,
  finite,
  gradeWalletEvidence,
  median
} = require('../src/lib/kolscan-wallet-evidence');

const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function watchWallet(address, name = 'Wallet') {
  return {
    walletAddress: address,
    name,
    rank: 1,
    bestRank: 1,
    leaderboardAppearances: [{
      timeframe: 'daily',
      rank: 1,
      reportedProfitSol: 10,
      wins: 10,
      losses: 5,
      winRate: 0.6667
    }]
  };
}

function walletSummary(address, pnlValues, overrides = {}) {
  const positions = pnlValues.map((pnl, index) => ({
    mint: `${MINT.slice(0, -2)}${String(index).padStart(2, '0')}`,
    sellCount: 1,
    realizedPnlSol: pnl,
    firstTxAt: '2026-08-01T00:00:00.000Z',
    lastTxAt: '2026-08-01T00:30:00.000Z'
  }));
  return {
    walletAddress: address,
    transactionsFetched: 200,
    realizedPositionCount: positions.length,
    proceedsOnlyPositionCount: 0,
    positions,
    ...overrides
  };
}

function run() {
  assert.strictEqual(finite(null), null);
  assert.strictEqual(finite(''), null);
  assert.strictEqual(median([3, 1, 2]), 2);
  assert.strictEqual(exTop([10, 9, 8, 2, 1], 3).total, 3);

  const addressA = '4TCMpxeevymUtCemwcVozhBLWq8Fikc1pVpfcW9zp66B';
  const durable = gradeWalletEvidence(
    watchWallet(addressA),
    walletSummary(addressA, Array(15).fill(0.02)),
    { snapshotHistory: { snapshotDayCount: 2 } }
  );
  assert.strictEqual(durable.grade, 'B');
  assert(durable.cautions.includes('WALLET_IDENTITY_RELATIONSHIP_SCREEN_UNAVAILABLE'));

  const heliusOnly = gradeWalletEvidence(
    { walletAddress: addressA, name: 'Manual wallet' },
    walletSummary(addressA, Array(15).fill(0.02))
  );
  assert.strictEqual(heliusOnly.grade, 'B');
  assert(heliusOnly.cautions.includes('THIRD_PARTY_PERFORMANCE_CLAIM_UNAVAILABLE'));

  const topHeavyValues = [1, 0.8, 0.6, 0.01, 0.01, 0.01, 0.01, 0.01, -0.02, -0.02, -0.02, -0.02];
  const topHeavy = gradeWalletEvidence(
    watchWallet(addressA),
    walletSummary(addressA, topHeavyValues),
    { snapshotHistory: { snapshotDayCount: 2 } }
  );
  assert.strictEqual(topHeavy.metrics.medianPnlSol > 0, true);
  assert.strictEqual(topHeavy.metrics.exTop3TotalPnlSol < 0, true);
  assert.strictEqual(topHeavy.grade, 'REJECT');
  assert(topHeavy.reasons.includes('NON_POSITIVE_EX_TOP3_REALIZED_PNL'));

  const smallSample = gradeWalletEvidence(
    watchWallet(addressA),
    walletSummary(addressA, Array(5).fill(0.1))
  );
  assert.strictEqual(smallSample.grade, 'WATCH');

  const nowMs = Date.parse('2026-08-02T12:00:00.000Z');
  const flowPosition = {
    mint: MINT,
    lastAction: 'BUY',
    lastActionSolDelta: -0.1,
    lastActionSignature: 'sig',
    lastTxAt: '2026-08-02T11:30:00.000Z',
    tokensRemaining: 100
  };
  const flow = buildFreshWalletFlow([
    { ...durable, walletAddress: addressA, positions: [flowPosition] },
    {
      ...durable,
      walletAddress: 'CAPn1yH4oSywsxGU456jfgTrSSUidf9jgeAnHceNUJdw',
      name: 'Wallet B',
      positions: [flowPosition]
    },
    {
      ...durable,
      walletAddress: 'BAr5csYtpWoNpwhUjixX7ZPHXkUciFZzjBp9uNxZXJPh',
      positions: [{ ...flowPosition, lastAction: 'SELL' }]
    }
  ], { nowMs });
  assert.strictEqual(flow.length, 1);
  assert.strictEqual(flow[0].qualifiedWalletCount, 2);
  assert.strictEqual(flow[0].walletAuditEligible, true);

  const singleWalletFlow = buildFreshWalletFlow([
    { ...durable, walletAddress: addressA, positions: [flowPosition] }
  ], { nowMs });
  assert.strictEqual(singleWalletFlow[0].walletAuditEligible, true);

  const settlementAssetFlow = buildFreshWalletFlow([
    {
      ...durable,
      walletAddress: addressA,
      positions: [{
        ...flowPosition,
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      }]
    }
  ], { nowMs });
  assert.strictEqual(settlementAssetFlow.length, 0);
  console.log('kolscan wallet evidence smoke passed');
}

run();
