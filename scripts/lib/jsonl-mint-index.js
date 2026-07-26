'use strict';

const { forEachJsonlSync } = require('./jsonl');

function payloadOf(event = {}) {
  return event.payload || event.data || {};
}

function mintOf(payload = {}, event = {}) {
  return payload.mint
    || payload.token
    || payload.mintAddress
    || payload.tokenMint
    || event.mint
    || event.token
    || event.mintAddress
    || event.tokenMint
    || null;
}

function indexJsonlEventsByMint(filePath, targetMints, options = {}) {
  const mints = new Set(Array.from(targetMints || []).filter(Boolean));
  const eventsByMint = new Map(Array.from(mints, (mint) => [mint, []]));
  const includeEvent = typeof options.includeEvent === 'function'
    ? options.includeEvent
    : () => true;
  let indexedEvents = 0;
  let candidateEvents = 0;
  let candidateEventsWithoutMint = 0;
  let candidateEventsOutsideTargetSet = 0;

  const stats = forEachJsonlSync(filePath, (event) => {
    const payload = payloadOf(event);
    if (!includeEvent(event, payload)) return;
    candidateEvents += 1;
    const mint = mintOf(payload, event);
    if (!mint) {
      candidateEventsWithoutMint += 1;
      return;
    }
    if (!mints.has(mint)) {
      candidateEventsOutsideTargetSet += 1;
      return;
    }
    eventsByMint.get(mint).push(event);
    indexedEvents += 1;
  }, options.jsonlOptions);

  return {
    eventsByMint,
    indexedEvents,
    candidateEvents,
    candidateEventsWithoutMint,
    candidateEventsOutsideTargetSet,
    rows: stats.rows,
    malformedLines: stats.malformedLines
  };
}

module.exports = {
  indexJsonlEventsByMint,
  mintOf,
  payloadOf
};
