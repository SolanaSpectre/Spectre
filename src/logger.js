const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

const ISSUE_LEVELS = new Set(['error', 'warn']);
const SECRET_KEY_PATTERN = /(secret|private|api[_-]?key|token|password|session|authorization|wallet)/i;
const MAX_RECENT_ISSUES = 80;
const MAX_SUMMARY_GROUPS = 25;

function redactString(value) {
  return String(value)
    .replace(/([?&](?:api-?key|apikey|key|token|auth|password|session)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b((?:api-?key|apikey|token|auth|password|session)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>');
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY_PATTERN.test(key)) return '<redacted>';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: value.code || undefined
    };
  }
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitize(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)])
    );
  }
  return String(value);
}

function summarizeIssues(recent) {
  const groups = new Map();

  for (const issue of recent) {
    const key = `${issue.level}:${issue.message}`;
    const group = groups.get(key) || {
      level: issue.level,
      message: issue.message,
      count: 0,
      firstAt: issue.timestamp,
      lastAt: issue.timestamp,
      latestData: null
    };

    group.count += 1;
    group.lastAt = issue.timestamp;
    if (issue.data !== null && issue.data !== undefined) {
      group.latestData = issue.data;
    }
    groups.set(key, group);
  }

  const byMessage = Array.from(groups.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(b.lastAt).localeCompare(String(a.lastAt));
  });

  const byLevel = recent.reduce(
    (acc, issue) => {
      acc[issue.level] = (acc[issue.level] || 0) + 1;
      return acc;
    },
    { warn: 0, error: 0 }
  );

  return {
    totalRecentIssues: recent.length,
    byLevel,
    uniqueIssueGroups: byMessage.length,
    topIssues: byMessage.slice(0, MAX_SUMMARY_GROUPS)
  };
}

class Logger {
  constructor(level = 'info') {
    this.level = level;
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };
    this.issueMirrorEnabled = process.env.LIVE_ISSUES_LOG_ENABLED !== 'false';
    this.issueMirrorDir = process.env.LIVE_ISSUES_LOG_DIR || path.join(process.cwd(), 'run-logs');
    this.issueMirrorPath = path.join(this.issueMirrorDir, 'live-terminal-issues.json');
    this.issueMirrorSummaryPath = path.join(this.issueMirrorDir, 'live-terminal-issues-summary.json');
    this.issueMirrorJsonlPath = path.join(this.issueMirrorDir, 'live-terminal-issues.jsonl');
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
    this.mirrorIssue('error', message, data);
    if (this.shouldLog('error')) {
      console.error(chalk.red(this.formatMessage('error', message, data)));
    }
  }

  warn(message, data = null) {
    this.mirrorIssue('warn', message, data);
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

  mirrorIssue(level, message, data = null) {
    if (!this.issueMirrorEnabled || !ISSUE_LEVELS.has(level)) return;

    const issue = {
      timestamp: new Date().toISOString(),
      level,
      message: redactString(message),
      data: sanitize(data)
    };

    try {
      fs.mkdirSync(this.issueMirrorDir, { recursive: true });
      fs.appendFileSync(this.issueMirrorJsonlPath, `${JSON.stringify(issue)}\n`, 'utf8');

      let recent = [];
      if (fs.existsSync(this.issueMirrorPath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(this.issueMirrorPath, 'utf8'));
          recent = Array.isArray(existing.recent) ? existing.recent : [];
        } catch (_) {
          recent = [];
        }
      }

      recent.push(issue);
      recent = recent.slice(-MAX_RECENT_ISSUES);
      const summary = summarizeIssues(recent);
      fs.writeFileSync(
        this.issueMirrorPath,
        `${JSON.stringify({
          generatedAt: issue.timestamp,
          mode: 'local_runtime_issue_mirror',
          note: 'Recent WARN/ERROR logger output for Codex inspection during paper runs. Secret-looking fields are redacted.',
          count: recent.length,
          recent
        }, null, 2)}\n`,
        'utf8'
      );
      fs.writeFileSync(
        this.issueMirrorSummaryPath,
        `${JSON.stringify({
          generatedAt: issue.timestamp,
          mode: 'local_runtime_issue_summary',
          note: 'Grouped WARN/ERROR logger output for quick Codex inspection during paper runs. Secret-looking fields are redacted.',
          sourcePath: this.issueMirrorPath,
          ...summary
        }, null, 2)}\n`,
        'utf8'
      );
    } catch (_) {
      // Avoid recursive logging if the diagnostic mirror cannot write.
    }
  }
}

module.exports = Logger;
