class SessionManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.state = 'STOPPED';
    this.sessionStartTime = null;
    this.sessionEndTime = null;
    this.cooldownUntil = null;
  }

  start() {
    this.sessionStartTime = Date.now();
    this.sessionEndTime = this.config.sessionDurationMinutes > 0
      ? this.sessionStartTime + (this.config.sessionDurationMinutes * 60 * 1000)
      : null;
    this.state = 'RUNNING';
  }

  stop(reason = 'STOPPED') {
    this.state = 'STOPPED';
    this.logger.info(`Session stopped: ${reason}`);
  }

  enterCooldown(reason, durationMs) {
    this.cooldownUntil = Date.now() + durationMs;
    this.state = 'COOLDOWN';
    this.logger.warn(`Cooldown started: ${reason}`, {
      durationMs,
      cooldownUntil: new Date(this.cooldownUntil).toISOString()
    });
  }

  maybeExpire() {
    if (this.state === 'RUNNING' && this.sessionEndTime && Date.now() >= this.sessionEndTime) {
      this.stop('SESSION_DURATION_EXCEEDED');
      return true;
    }

    if (this.state === 'COOLDOWN' && this.cooldownUntil && Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = null;
      this.state = 'RUNNING';
      this.logger.info('Cooldown ended');
    }

    return false;
  }

  isTradeAllowed() {
    this.maybeExpire();
    return this.state === 'RUNNING';
  }

  getStatus() {
    return {
      state: this.state,
      sessionStartTime: this.sessionStartTime,
      sessionEndTime: this.sessionEndTime,
      cooldownUntil: this.cooldownUntil
    };
  }
}

module.exports = SessionManager;
