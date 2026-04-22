class TradingEventFlow {
  constructor() {
    this.currentCycleId = null;
    this.currentCycleStartedAt = null;
    this.recentEvents = [];
    this.counts = new Map();
    this.maxRecentEvents = 50;
  }

  startCycle(meta = {}) {
    const cycleId = meta.cycleId || `cycle_${Date.now()}`;
    this.currentCycleId = cycleId;
    this.currentCycleStartedAt = new Date().toISOString();
    this.record('cycle.started', {
      cycleId,
      ...meta
    });
    return cycleId;
  }

  completeCycle(meta = {}) {
    this.record('cycle.completed', {
      cycleId: this.currentCycleId,
      ...meta
    });
  }

  failCycle(error, meta = {}) {
    this.record('cycle.failed', {
      cycleId: this.currentCycleId,
      message: error?.message || String(error || 'unknown error'),
      ...meta
    });
  }

  record(type, payload = {}) {
    const event = {
      type,
      timestamp: new Date().toISOString(),
      payload: {
        ...(this.currentCycleId ? { cycleId: this.currentCycleId } : {}),
        ...payload
      }
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.shift();
    }

    this.counts.set(type, (this.counts.get(type) || 0) + 1);
    return event;
  }

  getSummary() {
    return {
      currentCycleId: this.currentCycleId,
      currentCycleStartedAt: this.currentCycleStartedAt,
      counts: Object.fromEntries(this.counts),
      recentEvents: this.recentEvents.slice(-10).map((event) => ({
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload
      }))
    };
  }
}

module.exports = TradingEventFlow;
