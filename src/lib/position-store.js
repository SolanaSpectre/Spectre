const fs = require('fs');
const path = require('path');

class PositionStore {
  constructor(config, logger) {
    this.logger = logger;
    this.filePath = config.positionStateFilePath;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return [];
      }

      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const items = Array.isArray(parsed?.items) ? parsed.items : [];

      return items.filter((item) => item && item.token);
    } catch (error) {
      this.logger.warn('Failed to load persisted position state', error.message);
      return [];
    }
  }

  save(positions) {
    try {
      const items = Array.isArray(positions)
        ? positions.filter((item) => item && item.token)
        : [];

      fs.writeFileSync(this.filePath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        items
      }, null, 2), 'utf8');
    } catch (error) {
      this.logger.warn('Failed to persist position state', error.message);
    }
  }

  clear() {
    this.save([]);
  }
}

module.exports = PositionStore;
