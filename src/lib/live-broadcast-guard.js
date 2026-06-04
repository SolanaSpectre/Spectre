'use strict';

function isTruthy(value) {
  return ['true', '1', 'yes', 'y'].includes(String(value || '').toLowerCase());
}

function argvConfirmsLive(argv = process.argv.slice(2)) {
  return argv.some((arg, index) => {
    const text = String(arg || '');
    if (/^--confirmLive=(true|1|yes)$/i.test(text)) return true;
    return text === '--confirmLive' && isTruthy(argv[index + 1]);
  });
}

function liveBroadcastConfirmed() {
  return isTruthy(process.env.CONFIRM_LIVE) || argvConfirmsLive();
}

function assertLiveBroadcastAllowed(operation = 'sendRawTransaction') {
  const executionMode = String(process.env.EXECUTION_MODE || '').toUpperCase();
  if (executionMode !== 'LIVE' || !liveBroadcastConfirmed()) {
    throw new Error(
      `CRITICAL SAFETY VETO: ${operation} attempted without EXECUTION_MODE=LIVE and CONFIRM_LIVE=true or --confirmLive true`
    );
  }
}

module.exports = {
  assertLiveBroadcastAllowed,
  argvConfirmsLive,
  liveBroadcastConfirmed
};
