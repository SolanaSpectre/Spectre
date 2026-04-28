const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_LEDGER_PATH = path.join(REPO_ROOT, 'data', 'outcomes', 'outcome-ledger.jsonl');

function resolveRepoPath(filePath, fallback) {
  const selected = filePath || fallback;
  if (!selected) return null;
  return path.isAbsolute(selected) ? selected : path.join(REPO_ROOT, selected);
}

function appendOutcomeSessionEvent(kind, meta = {}) {
  const ledgerPath = resolveRepoPath(process.env.OUTCOME_LEDGER_FILE_PATH, DEFAULT_LEDGER_PATH);
  const sessionId = meta.sessionId || process.env.SPECTRE_SESSION_ID || `manual_${Date.now()}`;
  const event = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    kind,
    source: meta.source || 'session_lifecycle',
    stage: 'session',
    sessionId,
    mint: `SESSION:${sessionId}`,
    decision: String(kind || 'session.event').toUpperCase(),
    reason: meta.reason || null,
    session: {
      mode: meta.mode || process.env.EXECUTION_MODE || null,
      startedAt: meta.startedAt || null,
      stoppedAt: meta.stoppedAt || null,
      interruptedAt: meta.interruptedAt || null,
      shutdownClean: meta.shutdownClean ?? null,
      botExitCode: meta.botExitCode ?? null,
      signal: meta.signal || null,
      timedOut: Boolean(meta.timedOut)
    }
  };

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

if (require.main === module) {
  const kind = process.argv[2] || 'session.event';
  const reason = process.argv[3] || null;
  const cleanArg = process.argv[4];
  const now = new Date().toISOString();
  const event = appendOutcomeSessionEvent(kind, {
    reason,
    startedAt: kind === 'session.started' ? now : null,
    stoppedAt: kind === 'session.stopped' ? now : null,
    interruptedAt: kind === 'session.interrupted' ? now : null,
    shutdownClean: cleanArg === undefined ? null : cleanArg === 'true'
  });
  console.log(JSON.stringify(event, null, 2));
}

module.exports = appendOutcomeSessionEvent;
