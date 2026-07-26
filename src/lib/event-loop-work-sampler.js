'use strict';

class EventLoopWorkSampler {
  constructor(options = {}) {
    this.bucketMs = Math.max(25, Number(options.bucketMs || 100));
    this.maxBuckets = Math.max(1, Math.floor(Number(options.maxBuckets || 300)));
    this.maxSamplesPerBucket = Math.max(1, Number(options.maxSamplesPerBucket || 4));
    this.buckets = new Map();
    this.bucketOrder = [];
    this.stats = {
      samples: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      byPhase: {}
    };
  }

  measure(phase, fn, details = null) {
    const startedAtMs = Date.now();
    const startedHr = process.hrtime.bigint();
    try {
      // Async callbacks are intentionally measured only until they yield a Promise.
      return fn();
    } finally {
      const durationMs = Number(process.hrtime.bigint() - startedHr) / 1e6;
      this.record(phase, startedAtMs, durationMs, details);
    }
  }

  record(phase, startedAtMs, durationMs, details = null) {
    const normalizedPhase = String(phase || 'unknown');
    const normalizedStartedAtMs = Number(startedAtMs);
    const normalizedDurationMs = Number(durationMs);
    if (
      !Number.isFinite(normalizedStartedAtMs)
      || !Number.isFinite(normalizedDurationMs)
      || normalizedDurationMs < 0
    ) {
      return false;
    }

    const bucketStartMs = Math.floor(normalizedStartedAtMs / this.bucketMs) * this.bucketMs;
    let bucket = this.buckets.get(bucketStartMs);
    if (!bucket) {
      bucket = {
        startMs: bucketStartMs,
        endMs: bucketStartMs + this.bucketMs,
        phases: {}
      };
      this.buckets.set(bucketStartMs, bucket);
      this.bucketOrder.push(bucketStartMs);
      this.compact();
    }
    bucket.endMs = Math.max(
      bucket.endMs,
      normalizedStartedAtMs + normalizedDurationMs
    );

    const phaseStats = bucket.phases[normalizedPhase] || {
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      totalBytes: 0,
      samples: []
    };
    phaseStats.count += 1;
    phaseStats.totalDurationMs += normalizedDurationMs;
    phaseStats.maxDurationMs = Math.max(phaseStats.maxDurationMs, normalizedDurationMs);
    const bytes = Number(details?.bytes);
    if (Number.isFinite(bytes) && bytes >= 0) phaseStats.totalBytes += bytes;
    if (
      phaseStats.samples.length < this.maxSamplesPerBucket
      || normalizedDurationMs > phaseStats.samples[phaseStats.samples.length - 1].durationMs
    ) {
      phaseStats.samples.push({
        at: new Date(normalizedStartedAtMs).toISOString(),
        durationMs: this.round(normalizedDurationMs),
        type: details?.type || null,
        bytes: Number.isFinite(bytes) ? bytes : null
      });
      phaseStats.samples.sort((left, right) => right.durationMs - left.durationMs);
      phaseStats.samples = phaseStats.samples.slice(0, this.maxSamplesPerBucket);
    }
    bucket.phases[normalizedPhase] = phaseStats;

    this.stats.samples += 1;
    this.stats.totalDurationMs += normalizedDurationMs;
    this.stats.maxDurationMs = Math.max(this.stats.maxDurationMs, normalizedDurationMs);
    const aggregate = this.stats.byPhase[normalizedPhase] || {
      count: 0,
      totalDurationMs: 0,
      maxDurationMs: 0,
      totalBytes: 0
    };
    aggregate.count += 1;
    aggregate.totalDurationMs += normalizedDurationMs;
    aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, normalizedDurationMs);
    if (Number.isFinite(bytes) && bytes >= 0) aggregate.totalBytes += bytes;
    this.stats.byPhase[normalizedPhase] = aggregate;
    return true;
  }

  window(startMs, endMs) {
    const normalizedStartMs = Number(startMs);
    const normalizedEndMs = Number(endMs);
    if (!Number.isFinite(normalizedStartMs) || !Number.isFinite(normalizedEndMs)) {
      return null;
    }

    const phases = {};
    let bucketsObserved = 0;
    for (const bucketStartMs of this.bucketOrder) {
      const bucket = this.buckets.get(bucketStartMs);
      if (
        !bucket
        || bucket.endMs <= normalizedStartMs
        || bucket.startMs >= normalizedEndMs
      ) {
        continue;
      }
      bucketsObserved += 1;
      for (const [phase, row] of Object.entries(bucket.phases)) {
        const aggregate = phases[phase] || {
          count: 0,
          totalDurationMs: 0,
          maxDurationMs: 0,
          totalBytes: 0,
          samples: []
        };
        aggregate.count += row.count;
        aggregate.totalDurationMs += row.totalDurationMs;
        aggregate.maxDurationMs = Math.max(aggregate.maxDurationMs, row.maxDurationMs);
        aggregate.totalBytes += row.totalBytes;
        aggregate.samples.push(...row.samples);
        aggregate.samples.sort((left, right) => right.durationMs - left.durationMs);
        aggregate.samples = aggregate.samples.slice(0, this.maxSamplesPerBucket);
        phases[phase] = aggregate;
      }
    }

    const rankedPhases = Object.entries(phases)
      .map(([phase, row]) => ({
        phase,
        count: row.count,
        totalDurationMs: this.round(row.totalDurationMs),
        maxDurationMs: this.round(row.maxDurationMs),
        totalBytes: row.totalBytes,
        samples: row.samples
      }))
      .sort((left, right) => (
        right.totalDurationMs - left.totalDurationMs
        || right.maxDurationMs - left.maxDurationMs
      ));

    return {
      semantics: 'bounded_recent_sync_work_buckets_overlapping_timer_deadline_window',
      startAt: new Date(normalizedStartMs).toISOString(),
      endAt: new Date(normalizedEndMs).toISOString(),
      durationMs: Math.max(0, normalizedEndMs - normalizedStartMs),
      bucketMs: this.bucketMs,
      bucketsObserved,
      topPhases: rankedPhases.slice(0, 12)
    };
  }

  summary() {
    const byPhase = Object.fromEntries(
      Object.entries(this.stats.byPhase)
        .map(([phase, row]) => [phase, {
          count: row.count,
          totalDurationMs: this.round(row.totalDurationMs),
          meanDurationMs: row.count ? this.round(row.totalDurationMs / row.count) : null,
          maxDurationMs: this.round(row.maxDurationMs),
          totalBytes: row.totalBytes
        }])
        .sort((left, right) => (
          right[1].totalDurationMs - left[1].totalDurationMs
        ))
    );
    return {
      bucketMs: this.bucketMs,
      maxBuckets: this.maxBuckets,
      retainedBuckets: this.bucketOrder.length,
      samples: this.stats.samples,
      totalDurationMs: this.round(this.stats.totalDurationMs),
      maxDurationMs: this.round(this.stats.maxDurationMs),
      byPhase
    };
  }

  compact() {
    while (this.bucketOrder.length > this.maxBuckets) {
      const oldest = this.bucketOrder.shift();
      this.buckets.delete(oldest);
    }
  }

  round(value) {
    return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
  }
}

module.exports = EventLoopWorkSampler;
