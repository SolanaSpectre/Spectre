'use strict';

const DEFAULT_PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SIMULATION_ERROR_CLASSIFIER_EPOCH =
  'program_failure_provenance_v2_2026-07-27';

function errorText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeProgramErrorCode(value) {
  const match = String(value || '').trim().match(/^0x([0-9a-f]+)$/i);
  return match ? `0x${match[1].toLowerCase()}` : null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractProgramFailures(lines = []) {
  const failures = [];
  const pattern = /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+failed:\s+custom program error:\s*(0x[0-9a-f]+)/ig;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      failures.push({
        programId: match[1],
        programErrorCode: normalizeProgramErrorCode(match[2])
      });
    }
  }
  return failures;
}

function boundedFallbackClass(value) {
  const label = errorText(value).trim();
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(label) ? label : null;
}

function diagnoseSimulationError(error, logs = [], fallback = null, options = {}) {
  const lines = [error, ...(Array.isArray(logs) ? logs : [])]
    .map(errorText)
    .filter(Boolean);
  const text = lines.join('\n');
  const pumpProgramId = options.pumpProgramId || DEFAULT_PUMP_PROGRAM_ID;
  const programFailures = extractProgramFailures(lines);
  const innermostProgramFailure = programFailures[0] || null;
  const outermostProgramFailure = programFailures[programFailures.length - 1] || null;
  const pumpProgramFailure = [...programFailures].reverse().find(
    (failure) => failure.programId === pumpProgramId
  ) || null;
  const rawProgramErrorMatches = [...text.matchAll(/custom program error:\s*(0x[0-9a-f]+)/ig)];
  const rawProgramErrorCode = outermostProgramFailure?.programErrorCode
    || normalizeProgramErrorCode(rawProgramErrorMatches.at(-1)?.[1]);
  const rawProgramErrorCodeSource = outermostProgramFailure
    ? 'OUTERMOST_PROGRAM_FAILURE_FRAME'
    : rawProgramErrorCode
      ? 'UNSCOPED_CUSTOM_PROGRAM_ERROR_TEXT'
      : null;
  const anchorErrorNumberMatch = text.match(/Error Number:\s*(\d+)/i);
  const anchorErrorNumber = anchorErrorNumberMatch
    ? Number(anchorErrorNumberMatch[1])
    : null;
  const pumpProgramFramePattern = new RegExp(
    `Program\\s+${escapeRegExp(pumpProgramId)}\\s+(?:invoke|success|failed)`,
    'i'
  );
  const pumpProgramFrameObserved = lines.some(
    (line) => pumpProgramFramePattern.test(line)
  );

  let failureClass = null;
  let classificationBasis = null;

  if (
    /MintDoesNotMatchBondingCurve/i.test(text)
    || /Error Number:\s*6004/i.test(text)
    || /custom program error:\s*0x1774\b/i.test(text)
  ) {
    failureClass = 'BONDING_CURVE_MINT_MISMATCH';
    classificationBasis = 'KNOWN_PUMP_ERROR_NAME_OR_CODE';
  } else if (
    /BondingCurveComplete/i.test(text)
    || /Error Number:\s*6005/i.test(text)
    || /custom program error:\s*0x1775\b/i.test(text)
  ) {
    failureClass = 'BONDING_CURVE_COMPLETE';
    classificationBasis = 'KNOWN_PUMP_ERROR_NAME_OR_CODE';
  } else if (
    /TooMuchSolRequired/i.test(text)
    || /Error Number:\s*6002/i.test(text)
    || /custom program error:\s*0x1772\b/i.test(text)
  ) {
    failureClass = 'QUOTE_SLIPPAGE_RACE';
    classificationBasis = 'KNOWN_PUMP_ERROR_NAME_OR_CODE';
  } else if (/Slippage/i.test(text)) {
    failureClass = 'SIMULATION_SLIPPAGE';
    classificationBasis = 'EXPLICIT_SLIPPAGE_TEXT';
  } else if (/\binsufficient funds\b/i.test(text)) {
    failureClass = 'SIMULATION_INSUFFICIENT_FUNDS';
    classificationBasis = 'EXPLICIT_INSUFFICIENT_FUNDS_TEXT';
  } else if (rawProgramErrorCode) {
    failureClass = 'SIMULATION_CUSTOM_PROGRAM_ERROR';
    classificationBasis = 'UNCLASSIFIED_CUSTOM_PROGRAM_ERROR_CODE';
  } else {
    const fallbackClass = boundedFallbackClass(fallback);
    failureClass = fallbackClass || 'SIMULATION_UNCLASSIFIED';
    classificationBasis = fallbackClass
      ? 'BOUNDED_FALLBACK_CLASS'
      : 'UNCLASSIFIED_SIMULATION_ERROR';
  }

  return {
    classifierEpoch: SIMULATION_ERROR_CLASSIFIER_EPOCH,
    failureClass,
    classificationBasis,
    rawProgramErrorCode,
    rawProgramErrorCodeSource,
    anchorErrorNumber: Number.isFinite(anchorErrorNumber) ? anchorErrorNumber : null,
    innermostFailingProgramId: innermostProgramFailure?.programId || null,
    innermostProgramErrorCode: innermostProgramFailure?.programErrorCode || null,
    outermostFailingProgramId: outermostProgramFailure?.programId || null,
    outermostProgramErrorCode: outermostProgramFailure?.programErrorCode || null,
    pumpProgramFrameObserved,
    pumpProgramFailed: Boolean(pumpProgramFailure),
    pumpProgramErrorCode: pumpProgramFailure?.programErrorCode || null
  };
}

function classifySimulationError(error, logs = [], fallback = null, options = {}) {
  return diagnoseSimulationError(error, logs, fallback, options).failureClass;
}

function classifySimulationPayload(payload = {}, options = {}) {
  return classifySimulationError(
    payload.simulationErrorClass || payload.simulationError,
    [
      payload.simulationError,
      payload.reason,
      ...(Array.isArray(payload.simulationLogs) ? payload.simulationLogs : [])
    ],
    payload.simulationErrorClass || payload.reason || 'SIMULATION_UNCLASSIFIED',
    options
  );
}

function normalizeDryRunReason(payload = {}, options = {}) {
  if (payload.simulationOk === false || payload.reason === 'SIMULATION_FAILED') {
    return classifySimulationPayload(payload, options);
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
  DEFAULT_PUMP_PROGRAM_ID,
  SIMULATION_ERROR_CLASSIFIER_EPOCH,
  diagnoseSimulationError,
  classifySimulationError,
  classifySimulationPayload,
  normalizeDryRunReason,
  summarizeSimulationFailureCounts
};
