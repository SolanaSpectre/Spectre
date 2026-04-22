const chalk = require('chalk');

class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
  }

  shouldLog(level) {
    return this.levels[level] <= this.levels[this.level];
  }

  formatMessage(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    
    let output = `${prefix} ${message}`;
    
    if (data) {
      output += `\n${JSON.stringify(data, null, 2)}`;
    }
    
    return output;
  }

  error(message, data = null) {
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message, data)));
    }
  }

  warn(message, data = null) {
    if (this.shouldLog('warn')) {
      console.warn(chalk.yellow(this.formatMessage('warn', message, data)));
    }
  }

  info(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(chalk.blue(this.formatMessage('info', message, data)));
    }
  }

  debug(message, data = null) {
    if (this.shouldLog('debug')) {
      console.log(chalk.gray(this.formatMessage('debug', message, data)));
    }
  }

  success(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(chalk.green(this.formatMessage('info', message, data)));
    }
  }

  trade(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(chalk.magenta(this.formatMessage('info', message, data)));
    }
  }

  decision(message, data = null) {
    if (this.shouldLog('info')) {
      console.log(chalk.cyan(this.formatMessage('info', message, data)));
    }
  }
}

module.exports = Logger;
