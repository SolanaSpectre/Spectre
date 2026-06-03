const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'run-logs');
const OUTPUT_DIR = path.join(ROOT, 'data', 'reports', 'pumpdev-curve-parity');
const LATEST_PATH = path.join(ROOT, 'data', 'reports', 'pumpdev-curve-parity-latest.json');
const MAX_MATCH_AGE_MS = Number(process.env.PUMPDEV_CURVE_PARITY_MAX_MATCH_AGE_MS || 120_000);

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function numberOrNull(value, digits = null) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return digits === null ? numeric : Number(numeric.toFixed(digits));
}

function compact(value, digits = 6) {
  return numberOrNull(value, digits);
}

function absOrNull(value, digits = 6) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? compact(Math.abs(numeric), digits) : null;
}

function timestampMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function payloadOf(event) {
  return event.payload || event.data || {};
}

function mintOf(payload) {
  return payload.mint || payload.token || payload.mintAddress || null;
}

function latestTelemetryFile() {
  if (!fs.existsSync(LOG_DIR)) return null;
  const files = fs.readdirSync(LOG_DIR)
    .filter((name) => /^telemetry-.*\.jsonl$/i.test(name))
    .map((name) => {
      const filePath = path.join(LOG_DIR, name);
      const stat = fs.statSync(filePath);
      return { name, filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0] || null;
}

function sampleFrom(event, source) {
  const payload = payloadOf(event);
  const mint = mintOf(payload);
  const atMs = timestampMs(event.timestamp);
  if (!mint || !Number.isFinite(atMs)) return null;
  return {
    mint,
    at: event.timestamp,
    atMs,
    source,
    pairBase: payload.pairBase || null,
    complete: payload.complete === true,
    bondingStage: payload.bondingStage || null,
    curveProgress: numberOrNull(payload.curveProgress),
    curveProgressByRealTokenSupply: numberOrNull(payload.curveProgressByRealTokenSupply),
    curveProgressByVirtualTokenReserves: numberOrNull(payload.curveProgressByVirtualTokenReserves),
    virtualSolReservesSol: numberOrNull(payload.virtualSolReservesSol),
    virtualTokenReservesTokens: numberOrNull(payload.virtualTokenReservesTokens),
    priceSol: numberOrNull(payload.priceSol ?? payload.bondingCurvePriceSol),
    bondingCurveAddress: payload.bondingCurveAddress || payload.bondingCurveKey || null
  };
}

function nearestProviderSample(providerSamples, targetMs) {
  let best = null;
  for (const sample of providerSamples || []) {
    const ageMs = targetMs - sample.atMs;
    if (ageMs < 0 || ageMs > MAX_MATCH_AGE_MS) continue;
    if (!best || ageMs < best.ageMs) {
      best = { sample, ageMs };
    }
  }
  return best;
}

function stats(values, digits = 6) {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!finite.length) {
    return { count: 0, min: null, median: null, p90: null, max: null, avg: null };
  }
  const pick = (q) => finite[Math.min(finite.length - 1, Math.floor((finite.length - 1) * q))];
  const sum = finite.reduce((total, value) => total + value, 0);
  return {
    count: finite.length,
    min: compact(finite[0], digits),
    median: compact(pick(0.5), digits),
    p90: compact(pick(0.9), digits),
    max: compact(finite[finite.length - 1], digits),
    avg: compact(sum / finite.length, digits)
  };
}

async function readSamples(filePath) {
  const byMint = new Map();
  const counts = {
    providerSnapshots: 0,
    onchainUpdates: 0,
    malformedLines: 0
  };

  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    let event = null;
    try {
      event = JSON.parse(line.replace(/^\uFEFF/, ''));
    } catch {
      counts.malformedLines += 1;
      continue;
    }

    let sample = null;
    if (event.type === 'pump_bonding_curve.provider_snapshot') {
      sample = sampleFrom(event, 'provider');
      if (sample) counts.providerSnapshots += 1;
    } else if (event.type === 'pump_bonding_curve.updated') {
      sample = sampleFrom(event, 'onchain');
      if (sample) counts.onchainUpdates += 1;
    } else {
      continue;
    }

    if (!sample) continue;
    const record = byMint.get(sample.mint) || { provider: [], onchain: [] };
    record[sample.source].push(sample);
    byMint.set(sample.mint, record);
  }

  for (const record of byMint.values()) {
    record.provider.sort((a, b) => a.atMs - b.atMs);
    record.onchain.sort((a, b) => a.atMs - b.atMs);
  }

  return { byMint, counts };
}

function buildReport(file, samples) {
  const matches = [];
  let onchainWithProviderMint = 0;
  let unmatchedOnchain = 0;

  for (const [mint, record] of samples.byMint.entries()) {
    if (!record.onchain.length) continue;
    if (record.provider.length) onchainWithProviderMint += record.onchain.length;

    for (const onchain of record.onchain) {
      const match = nearestProviderSample(record.provider, onchain.atMs);
      if (!match) {
        unmatchedOnchain += 1;
        continue;
      }

      const provider = match.sample;
      const curveDelta = Number.isFinite(onchain.curveProgress) && Number.isFinite(provider.curveProgress)
        ? onchain.curveProgress - provider.curveProgress
        : null;
      const virtualReserveCurveDelta = Number.isFinite(onchain.curveProgressByVirtualTokenReserves) && Number.isFinite(provider.curveProgress)
        ? onchain.curveProgressByVirtualTokenReserves - provider.curveProgress
        : null;
      const priceDeltaPct = Number.isFinite(onchain.priceSol) && onchain.priceSol > 0 && Number.isFinite(provider.priceSol) && provider.priceSol > 0
        ? ((provider.priceSol - onchain.priceSol) / onchain.priceSol) * 100
        : null;
      const tokenReserveDeltaPct = Number.isFinite(onchain.virtualTokenReservesTokens) && onchain.virtualTokenReservesTokens > 0 && Number.isFinite(provider.virtualTokenReservesTokens)
        ? ((provider.virtualTokenReservesTokens - onchain.virtualTokenReservesTokens) / onchain.virtualTokenReservesTokens) * 100
        : null;
      const solReserveDeltaPct = Number.isFinite(onchain.virtualSolReservesSol) && onchain.virtualSolReservesSol > 0 && Number.isFinite(provider.virtualSolReservesSol)
        ? ((provider.virtualSolReservesSol - onchain.virtualSolReservesSol) / onchain.virtualSolReservesSol) * 100
        : null;

      matches.push({
        mint,
        providerAt: provider.at,
        onchainAt: onchain.at,
        ageMs: match.ageMs,
        pairBase: provider.pairBase || onchain.pairBase || null,
        completionRace: onchain.complete === true && Number(provider.curveProgress) < 0.95,
        onchainComplete: onchain.complete === true,
        onchainBondingStage: onchain.bondingStage || null,
        providerCurveProgress: compact(provider.curveProgress),
        onchainCurveProgress: compact(onchain.curveProgress),
        onchainCurveProgressByRealTokenSupply: compact(onchain.curveProgressByRealTokenSupply),
        onchainCurveProgressByVirtualTokenReserves: compact(onchain.curveProgressByVirtualTokenReserves),
        curveDelta: compact(curveDelta),
        absCurveDelta: absOrNull(curveDelta),
        virtualReserveCurveDelta: compact(virtualReserveCurveDelta),
        virtualReserveAbsCurveDelta: absOrNull(virtualReserveCurveDelta),
        providerPriceSol: compact(provider.priceSol, 12),
        onchainPriceSol: compact(onchain.priceSol, 12),
        priceDeltaPct: compact(priceDeltaPct, 4),
        absPriceDeltaPct: absOrNull(priceDeltaPct, 4),
        tokenReserveDeltaPct: compact(tokenReserveDeltaPct, 4),
        solReserveDeltaPct: compact(solReserveDeltaPct, 4),
        bondingCurveAddress: onchain.bondingCurveAddress || provider.bondingCurveAddress || null
      });
    }
  }

  const absCurveDeltas = matches.map((match) => match.absCurveDelta);
  const virtualReserveAbsCurveDeltas = matches.map((match) => match.virtualReserveAbsCurveDelta);
  const absPriceDeltas = matches.map((match) => match.absPriceDeltaPct);
  const ageValues = matches.map((match) => Number(match.ageMs)).filter(Number.isFinite);
  const completionRaceMatches = matches.filter((match) => match.completionRace === true);
  const nonCompletionRaceMatches = matches.filter((match) => match.completionRace !== true);
  const nonCompletionAbsCurveDeltas = nonCompletionRaceMatches
    .map((match) => match.absCurveDelta);
  const nonCompletionVirtualReserveAbsCurveDeltas = nonCompletionRaceMatches
    .map((match) => match.virtualReserveAbsCurveDelta);
  const largestCurveDeltas = [...matches]
    .filter((match) => Number.isFinite(Number(match.absCurveDelta)))
    .sort((a, b) => Number(b.absCurveDelta) - Number(a.absCurveDelta))
    .slice(0, 20);

  let verdict = 'insufficient_overlap';
  if (matches.length >= 10) {
    const medianCurve = stats(absCurveDeltas).median;
    verdict = Number.isFinite(Number(medianCurve)) && Number(medianCurve) <= 0.015
      ? 'provider_curve_snapshot_parity_good'
      : 'provider_curve_snapshot_needs_review';
  } else if (matches.length > 0) {
    verdict = 'limited_overlap';
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceTelemetry: file ? path.relative(ROOT, file.filePath) : null,
    matchWindowMs: MAX_MATCH_AGE_MS,
    verdict,
    counts: {
      providerSnapshots: samples.counts.providerSnapshots,
      onchainUpdates: samples.counts.onchainUpdates,
      onchainUpdatesWithProviderMint: onchainWithProviderMint,
      matchedPairs: matches.length,
      completionRaceMatches: completionRaceMatches.length,
      nonCompletionRaceMatches: nonCompletionRaceMatches.length,
      unmatchedOnchain,
      uniqueMintsWithAnyCurveSample: samples.byMint.size,
      malformedLines: samples.counts.malformedLines
    },
    deltas: {
      providerToOnchainAgeMs: stats(ageValues, 0),
      absCurveDelta: stats(absCurveDeltas, 6),
      nonCompletionRaceAbsCurveDelta: stats(nonCompletionAbsCurveDeltas, 6),
      virtualReserveAbsCurveDelta: stats(virtualReserveAbsCurveDeltas, 6),
      nonCompletionRaceVirtualReserveAbsCurveDelta: stats(nonCompletionVirtualReserveAbsCurveDeltas, 6),
      absPriceDeltaPct: stats(absPriceDeltas, 4)
    },
    largestCurveDeltas,
    recommendations: matches.length < 10
      ? [
          'Need more overlap between PumpDev provider snapshots and on-chain bonding-curve refreshes before treating parity as proven.',
          'Keep PumpDev primary in paper mode, but sample on-chain verification for higher-interest or near-entry candidates.'
        ]
      : [
          verdict === 'provider_curve_snapshot_parity_good'
            ? 'Provider curve snapshots are close to on-chain refreshes in this run; continue sampling parity in paper.'
            : 'Provider curve snapshot deltas are large enough to review formula/pair handling before live.',
          'Do not use USDC pair snapshots for SOL-denominated entries until the USDC pricing lane is explicitly modeled.'
        ]
  };
}

async function main() {
  const file = latestTelemetryFile();
  if (!file) {
    const report = {
      generatedAt: new Date().toISOString(),
      verdict: 'no_telemetry',
      counts: { providerSnapshots: 0, onchainUpdates: 0, matchedPairs: 0 },
      recommendations: ['Run a paper session before evaluating PumpDev curve parity.']
    };
    ensureDir(LATEST_PATH);
    fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Wrote PumpDev curve parity report: ${LATEST_PATH}`);
    return;
  }

  const samples = await readSamples(file.filePath);
  const report = buildReport(file, samples);
  const stampedPath = path.join(OUTPUT_DIR, `pumpdev-curve-parity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  ensureDir(stampedPath);
  fs.writeFileSync(stampedPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  ensureDir(LATEST_PATH);
  fs.writeFileSync(LATEST_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Wrote PumpDev curve parity report: ${stampedPath}`);
  console.log(`Wrote latest PumpDev curve parity report: ${LATEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
