"use strict";

/** Cache mémoire TTL — évite de régénérer les métadonnées et contenus. */

const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

function set(key, value, ttlMs = 60_000) {
  store.set(key, { value, expires: Date.now() + ttlMs });
  if (store.size > 500) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
  }
  return value;
}

function wrap(key, ttlMs, producer) {
  const cached = get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  return Promise.resolve(producer()).then((value) => set(key, value, ttlMs));
}

function clear(prefix) {
  if (!prefix) return store.clear();
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}

module.exports = { get, set, wrap, clear };
