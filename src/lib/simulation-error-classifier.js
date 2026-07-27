'use strict';

function errorText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function classifySimulationError(error, logs = [], fallback = null) {
  const text = [error, ...(Array.isArray(logs) ? logs : [])]
    .map(errorText)
    .filter(Boolean)
    .join('\n');

  if (
    /MintDoesNotMatchBondingCurve/i.test(text)
    || /Error Number:\s*6004/i.test(text)
    || /custom program error:\s*0x1774\b/i.test(text)
  ) {
    return 'BONDING_CURVE_MINT_MISMATCH';
  }
  if (
    /BondingCurveComplete/i.test(text)
    || /Error Number:\s*6005/i.test(text)
    || /custom program error:\s*0x1775\b/i.test(text)
  ) {
    return 'BONDING_CURVE_COMPLETE';
  }
  if (
    /TooMuchSolRequired/i.test(text)
    || /Error Number:\s*6002/i.test(text)
    || /custom program error:\s*0x1772\b/i.test(text)
  ) {
    return 'QUOTE_SLIPPAGE_RACE';
  }
  if (/Slippage/i.test(text)) return 'SIMULATION_SLIPPAGE';
  if (
    /insufficient funds/i.test(text)
    || /custom program error:\s*0x1(?![0-9a-f])/i.test(text)
  ) {
    return 'SIMULATION_INSUFFICIENT_FUNDS';
  }

  return fallback || errorText(error) || 'SIMULATION_FAILED';
}

function classifySimulationPayload(payload = {}) {
  return classifySimulationError(
    payload.simulationErrorClass || payload.simulationError,
    [
      payload.simulationError,
      payload.reason,
      ...(Array.isArray(payload.simulationLogs) ? payload.simulationLogs : [])
    ],
    payload.simulationErrorClass || payload.simulationError || payload.reason || 'SIMULATION_FAILED'
  );
}

function normalizeDryRunReason(payload = {}) {
  if (payload.simulationOk === false || payload.reason === 'SIMULATION_FAILED') {
    return classifySimulationPayload(payload);
  }
  return payload.reason || payload.blockReason || payload.sourceReason || null;
}

function summarizeSimulationFailureCounts(counts = {}) {
  let total = 0;
  let expectedStateRace = 0;
  let expectedQuoteRace = 0;
  let critical = 0;

  for (const [failureClass, rawCount] of Object.entries(counts || {})) {
    const count = Number(rawCount);
    if (!Number.isFinite(count) || count <= 0) continue;
    total += count;
    if (failureClass === 'BONDING_CURVE_COMPLETE') {
      expectedStateRace += count;
    } else if (failureClass === 'QUOTE_SLIPPAGE_RACE') {
      expectedQuoteRace += count;
    } else {
      critical += count;
    }
  }

  return { total, expectedStateRace, expectedQuoteRace, critical };
}

module.exports = {
  classifySimulationError,
  classifySimulationPayload,
  normalizeDryRunReason,
  summarizeSimulationFailureCounts
};
