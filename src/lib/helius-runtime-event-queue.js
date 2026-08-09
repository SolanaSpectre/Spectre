'use strict';

function runtimeEvent(type, payload = {}, kind, source, telemetryType) {
  const mint = payload.mint || payload.token || payload.mintAddress || null;
  if (!mint) return null;

  return {
    kind,
    mint,
    type: String(type || ''),
    event: {
      ...payload,
      mint,
      source,
      reportOnly: false,
      strategyConsumptionEnabled: true
    },
    options: {
      provider: 'helius',
      telemetryType,
      defaultSource: source,
      source,
      targetedRpcPrefilter: false
    }
  };
}

function classifyHeliusRuntimeEvent(type, payload = {}) {
  const eventType = String(type || '');
  if (eventType.endsWith('shadow_new_token')) {
    return runtimeEvent(
      eventType,
      payload,
      'new_token',
      'helius_logs_create_runtime',
      'provider.helius_pumpfun.runtime_new_token'
    );
  }
  if (eventType.endsWith('shadow_trade')) {
    return runtimeEvent(
      eventType,
      payload,
      'trade',
      'helius_logs_trade_runtime',
      'provider.helius_pumpfun.runtime_trade'
    );
  }
  if (eventType.endsWith('shadow_complete')) {
    return runtimeEvent(
      eventType,
      payload,
      'migration',
      'helius_logs_complete_runtime',
      'provider.helius_pumpfun.runtime_complete'
    );
  }
  if (eventType.endsWith('shadow_migration')) {
    return runtimeEvent(
      eventType,
      payload,
      'migration',
      'helius_logs_migration_runtime',
      'provider.helius_pumpfun.runtime_migration'
    );
  }
  return null;
}

class HeliusRuntimeEventQueue {
  constructor({ enabled = false, maxPending = 20_000, handler, onError } = {}) {
    this.enabled = enabled === true;
    this.maxPending = Math.max(100, Number(maxPending || 20_000));
    this.handler = handler;
    this.onError = onError;
    this.tails = new Map();
    this.pending = 0;
    this.stats = {
      enabled: this.enabled,
      enqueued: 0,
      processed: 0,
      ignored: 0,
      handlerErrors: 0,
      overflowRejected: 0,
      maxPending: 0,
      drainCalls: 0,
      drainTimeouts: 0,
      lastErrorAt: null,
      lastErrorName: null
    };
  }

  enqueue(type, payload = {}) {
    if (!this.enabled) {
      this.stats.ignored += 1;
      return false;
    }

    const mapped = classifyHeliusRuntimeEvent(type, payload);
    if (!mapped) {
      this.stats.ignored += 1;
      return false;
    }

    if (this.pending >= this.maxPending) {
      this.stats.overflowRejected += 1;
      this.reportError({
        errorName: 'QueueOverflowError',
        type: mapped.type,
        kind: mapped.kind,
        mint: mapped.mint
      });
      return false;
    }

    const previous = this.tails.get(mapped.mint) || Promise.resolve();
    this.pending += 1;
    this.stats.enqueued += 1;
    this.stats.maxPending = Math.max(this.stats.maxPending, this.pending);

    const task = previous
      .catch(() => undefined)
      .then(() => this.handler?.(mapped))
      .catch((error) => {
        this.stats.handlerErrors += 1;
        this.reportError({
          errorName: error?.name || 'Error',
          type: mapped.type,
          kind: mapped.kind,
          mint: mapped.mint
        });
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
        this.stats.processed += 1;
        if (this.tails.get(mapped.mint) === task) {
          this.tails.delete(mapped.mint);
        }
      });

    this.tails.set(mapped.mint, task);
    return true;
  }

  reportError(context) {
    this.stats.lastErrorAt = new Date().toISOString();
    this.stats.lastErrorName = context.errorName || 'Error';
    try {
      this.onError?.(context);
    } catch {
      // Runtime error reporting must not create another intake failure.
    }
  }

  async drain(timeoutMs = 5000) {
    this.stats.drainCalls += 1;
    const pending = [...this.tails.values()];
    if (pending.length === 0) return true;

    let timeout;
    const completed = Promise.allSettled(pending).then(() => true);
    const expired = new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), Math.max(1, Number(timeoutMs || 5000)));
    });
    const drained = await Promise.race([completed, expired]);
    clearTimeout(timeout);
    if (!drained) this.stats.drainTimeouts += 1;
    return drained;
  }

  getStats() {
    return {
      ...this.stats,
      pending: this.pending,
      activeMints: this.tails.size,
      maxPendingLimit: this.maxPending
    };
  }
}

module.exports = {
  HeliusRuntimeEventQueue,
  classifyHeliusRuntimeEvent
};
