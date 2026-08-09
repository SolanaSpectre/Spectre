const assert = require('assert');
const TradingEngine = require('../src/trading-engine');
const AccountingService = require('../src/lib/accounting');

const PROFILE = {
  stopLossPercent: 0.022,
  takeProfitPercent: 0.08,
  trailingActivationPercent: 0.035,
  trailingDrawdownPercent: 0.014,
  breakevenActivationPercent: 0.025,
  breakevenStopPercent: 0.002,
  minProfitHoldSeconds: 45,
  maxHoldMinutes: 18,
  profileName: 'runner_breakout_smart_trade'
};

function makeEngine(markValueSol) {
  const telemetry = [];
  const ledger = [];
  const quoteCalls = [];
  const accountingCloses = [];
  const engine = Object.create(TradingEngine.prototype);
  engine.currentPositions = new Map();
  engine.paperPositions = new Map();
  engine.paperWalletBalanceSol = 1;
  engine.realizedPnL = 0;
  engine.dailyPnL = 0;
  engine.sessionId = 'paper-exit-smoke';
  engine.config = {
    tokenSignalCooldownMs: 1,
    quoteFailureQuarantineMs: 1,
    badExitCooldownMs: 1,
    weakExitCooldownMs: 1
  };
  engine.executionModeManager = {
    isPaper: () => true,
    isLive: () => false
  };
  engine.marketData = {
    getTokenPrice: async () => {
      throw new Error('cached spot price path must not be used for paper exits');
    },
    getTokenValueInSol: async (mint, amountRaw) => {
      quoteCalls.push({ mint, amountRaw });
      if (markValueSol instanceof Error) throw markValueSol;
      return markValueSol;
    }
  };
  engine.accounting = {
    openPosition: () => ({ id: 'paper-position-1' }),
    closePositionByValue: (positionId, exitValueSol, exitPrice) => {
      accountingCloses.push({ positionId, exitValueSol, exitPrice });
      return { id: positionId, status: 'CLOSED' };
    }
  };
  engine.telemetry = {
    record: (type, payload) => telemetry.push({ type, payload })
  };
  engine.strategyLedger = {
    record: (type, payload) => ledger.push({ type, payload })
  };
  engine.logger = {
    trade: () => undefined,
    warn: () => undefined
  };
  engine.buildPaperExitProfile = () => ({ ...PROFILE });
  engine.applyExitCooldown = () => undefined;
  return { engine, telemetry, ledger, quoteCalls, accountingCloses };
}

async function openRunnerPosition(engine) {
  return engine.executeBuyPaper(
    {
      token: 'RunnerMint111111111111111111111111111111111',
      amount: 0.1,
      tokenInfo: { price: 0.000001 },
      qualityScore: 0.8,
      momentumScore: 0.9
    },
    {
      outAmount: '250000000000',
      _fetchTimestamp: Date.now()
    },
    {
      confidence: 85,
      primaryStrategy: 'RUNNER_HUNTER',
      convergenceScore: 0.85,
      action: 'ENTER',
      executionProfile: {
        entryUrgency: 'high',
        expectedHold: 'short_to_medium',
        exitStyle: 'trailing_runner'
      }
    }
  );
}

async function main() {
  {
    const { engine, telemetry, quoteCalls, accountingCloses } = makeEngine(0.0977);
    const opened = await openRunnerPosition(engine);
    assert.equal(opened.success, true);
    assert.equal(opened.tokenAmountRaw, '250000000000');
    assert.equal(engine.paperPositions.size, 1);

    await engine.updatePositions();

    assert.equal(quoteCalls.length, 1);
    assert.deepEqual(quoteCalls[0], {
      mint: 'RunnerMint111111111111111111111111111111111',
      amountRaw: '250000000000'
    });
    assert.equal(engine.paperPositions.size, 0, 'fresh -2.3% executable quote must trigger the -2.2% stop');
    assert(Math.abs(engine.realizedPnL - (-0.0023)) < 1e-12);
    assert.equal(accountingCloses.length, 1);
    assert.equal(accountingCloses[0].positionId, 'paper-position-1');
    assert.equal(accountingCloses[0].exitValueSol, 0.0977);
    const openedEvent = telemetry.find((event) => event.type === 'paper.position.opened');
    const markedEvent = telemetry.find((event) => event.type === 'paper.position.marked');
    assert.equal(openedEvent?.payload?.positionId, 'paper-position-1');
    assert.equal(markedEvent?.payload?.positionId, 'paper-position-1');
    assert.equal(markedEvent?.payload?.markSource, 'JUPITER_EXECUTABLE_SELL_QUOTE');
    const closed = telemetry.find((event) => event.type === 'paper.position.closed');
    assert(closed, 'close telemetry must be emitted');
    assert.equal(closed.payload.reason, 'STOP_LOSS');
    assert.equal(closed.payload.markSource, 'JUPITER_EXECUTABLE_SELL_QUOTE');
    assert.equal(closed.payload.configuredStopLossPercent, 0.022);
    assert.equal(closed.payload.tokenAmountRaw, '250000000000');
    assert(closed.payload.markAgeMs >= 0 && closed.payload.markAgeMs < 1000);

    await engine.updatePositions();
    assert.equal(quoteCalls.length, 1, 'a closed position must never be quoted twice');
  }

  {
    const { engine, telemetry } = makeEngine(0);
    await openRunnerPosition(engine);
    await engine.updatePositions();
    assert.equal(engine.paperPositions.size, 1, 'missing quote output must not synthesize a zero-value exit');
    const skipped = telemetry.find((event) => event.type === 'paper.position.mark_skipped');
    assert.equal(skipped?.payload?.reason, 'EXECUTABLE_SELL_QUOTE_NO_OUTPUT');
  }

  {
    const { engine, telemetry } = makeEngine(new TypeError('fixture quote failure'));
    await openRunnerPosition(engine);
    await engine.updatePositions();
    assert.equal(engine.paperPositions.size, 1, 'quote errors must preserve the position for the next mark attempt');
    const failed = telemetry.find((event) => event.type === 'paper.position.mark_failed');
    assert.equal(failed?.payload?.reason, 'EXECUTABLE_SELL_QUOTE_FAILED');
    assert.equal(failed?.payload?.errorType, 'TypeError');
  }

  {
    const accounting = new AccountingService();
    const position = accounting.openPosition({
      mint: 'AccountingMint',
      mode: 'PAPER',
      entryPrice: 0.000001,
      size: 0.1,
      entryValueSol: 0.1,
      signalId: 'accounting-value-smoke'
    });
    accounting.closePositionByValue(position.id, 0.0977, 0.000000977);
    assert(Math.abs(position.netPnL - (-0.0023)) < 1e-12);
    assert(Math.abs(accounting.getStats().realizedPnL - (-0.0023)) < 1e-12);
  }

  {
    const { engine } = makeEngine(0.1);
    const rejected = await engine.executeBuyPaper(
      { token: 'NoOutputMint', amount: 0.1, tokenInfo: { price: 1 } },
      { outAmount: '0' },
      { primaryStrategy: 'RUNNER_HUNTER' }
    );
    assert.deepEqual(rejected, { success: false, reason: 'PAPER_ENTRY_QUOTE_NO_OUTPUT' });
    assert.equal(engine.paperWalletBalanceSol, 1, 'a malformed entry quote must not debit the paper wallet');
  }

  console.log('Paper executable exit monitor smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
