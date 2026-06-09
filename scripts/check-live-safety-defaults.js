const assert = require('assert');
const Config = require('../src/config');

const originalEnv = { ...process.env };

function withEnv(overrides, fn) {
  process.env = { ...originalEnv, ...overrides };
  try {
    fn();
  } finally {
    process.env = { ...originalEnv };
  }
}

withEnv({
  LIVE_EXIT_ENGINE_ENABLED: undefined,
  MAX_OPEN_LIVE_POSITIONS: undefined
}, () => {
  delete process.env.LIVE_EXIT_ENGINE_ENABLED;
  delete process.env.MAX_OPEN_LIVE_POSITIONS;
  assert.strictEqual(Config.liveExitEngineEnabled, false, 'LIVE_EXIT_ENGINE_ENABLED must default disabled');
  assert.strictEqual(Config.maxOpenLivePositions, 1, 'MAX_OPEN_LIVE_POSITIONS must default to one live slot');
});

withEnv({
  LIVE_EXIT_ENGINE_ENABLED: 'true',
  MAX_OPEN_LIVE_POSITIONS: '2'
}, () => {
  assert.strictEqual(Config.liveExitEngineEnabled, true, 'LIVE_EXIT_ENGINE_ENABLED=true should explicitly enable the live exit engine');
  assert.strictEqual(Config.maxOpenLivePositions, 2, 'MAX_OPEN_LIVE_POSITIONS should honor explicit numeric config');
});

console.log('Live safety defaults check passed');
