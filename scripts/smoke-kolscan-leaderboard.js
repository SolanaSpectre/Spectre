'use strict';

const assert = require('assert');
const {
  buildPayload,
  extractLeaderboardEntries
} = require('./fetch-kolscan-leaderboard');

function flightHtml(entries) {
  const payload = `0:["$","$L11",null,{"initLeaderboard":${JSON.stringify(entries)}}]`;
  return `<html><script>self.__next_f.push(${JSON.stringify([1, payload])})</script></html>`;
}

function run() {
  const walletA = '4TCMpxeevymUtCemwcVozhBLWq8Fikc1pVpfcW9zp66B';
  const walletB = 'CAPn1yH4oSywsxGU456jfgTrSSUidf9jgeAnHceNUJdw';
  const rows = [
    { wallet_address: walletA, name: 'A', profit: 5, wins: 2, losses: 1, timeframe: 1 },
    { wallet_address: walletB, name: 'B', profit: 10, wins: 1, losses: 0, timeframe: 1 },
    { wallet_address: walletA, name: 'A', profit: 20, wins: 8, losses: 2, timeframe: 7 },
    { wallet_address: walletA, name: 'A', profit: 30, wins: 12, losses: 3, timeframe: 30 }
  ];
  const extracted = extractLeaderboardEntries(flightHtml(rows));
  assert.deepStrictEqual(extracted, rows);

  const payload = buildPayload(extracted, '2026-08-02T12:00:00.000Z');
  assert.strictEqual(payload.count, 2);
  assert.strictEqual(payload.entryCount, 4);
  assert.deepStrictEqual(payload.coverage.availableTimeframes, ['daily', 'weekly', 'monthly']);
  assert.strictEqual(payload.timeframes.daily.entries[0].walletAddress, walletB);
  assert.strictEqual(payload.timeframes.daily.entries[0].rank, 1);
  const a = payload.wallets.find((wallet) => wallet.walletAddress === walletA);
  assert.strictEqual(a.leaderboardTimeframeCount, 3);
  assert.strictEqual(a.leaderboardAppearances.find((row) => row.timeframe === 'weekly').reportedProfitSol, 20);

  const profileHydrationOnly = flightHtml([]).replace('initLeaderboard', 'initialData');
  assert.throws(
    () => extractLeaderboardEntries(profileHydrationOnly),
    /Could not extract current Kolscan initLeaderboard rows/
  );
  console.log('kolscan leaderboard smoke passed');
}

run();
