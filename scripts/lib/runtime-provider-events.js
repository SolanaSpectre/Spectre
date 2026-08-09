'use strict';

const RUNTIME_PROVIDER_EVENT_TYPES = Object.freeze({
  newToken: Object.freeze([
    'provider.helius_pumpfun.runtime_new_token',
    'provider.pumpportal.new_token',
    'provider.pumpdev.runtime_new_token'
  ]),
  trade: Object.freeze([
    'provider.helius_pumpfun.runtime_trade',
    'provider.pumpportal.trade',
    'provider.pumpdev.runtime_trade'
  ]),
  migration: Object.freeze([
    'provider.helius_pumpfun.runtime_complete',
    'provider.helius_pumpfun.runtime_migration',
    'provider.pumpportal.migration',
    'provider.pumpdev.runtime_migration'
  ])
});

const TYPE_INDEX = new Map();
for (const [kind, types] of Object.entries(RUNTIME_PROVIDER_EVENT_TYPES)) {
  for (const type of types) TYPE_INDEX.set(type, kind);
}

function eventTypeOf(eventOrType) {
  if (typeof eventOrType === 'string') return eventOrType;
  return eventOrType?.type || eventOrType?.event || eventOrType?.name || '';
}

function runtimeProviderKind(eventOrType) {
  return TYPE_INDEX.get(eventTypeOf(eventOrType)) || null;
}

function isRuntimeProviderEvent(eventOrType, kind = null) {
  const actualKind = runtimeProviderKind(eventOrType);
  return kind ? actualKind === kind : actualKind !== null;
}

function runtimeProviderName(eventOrType) {
  const type = eventTypeOf(eventOrType);
  if (type.startsWith('provider.helius_pumpfun.')) return 'helius';
  if (type.startsWith('provider.pumpportal.')) return 'pumpportal';
  if (type.startsWith('provider.pumpdev.')) return 'pumpdev';
  return null;
}

function countRuntimeProviderEvents(eventCounts = {}, kind) {
  const types = RUNTIME_PROVIDER_EVENT_TYPES[kind] || [];
  return types.reduce((sum, type) => sum + Number(eventCounts[type] || 0), 0);
}

module.exports = {
  RUNTIME_PROVIDER_EVENT_TYPES,
  countRuntimeProviderEvents,
  eventTypeOf,
  isRuntimeProviderEvent,
  runtimeProviderKind,
  runtimeProviderName
};
