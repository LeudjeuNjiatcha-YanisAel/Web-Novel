"use strict";

/** Limitation de débit simple, en mémoire, par identifiant (IP). */

const buckets = new Map();

function limiter({ windowMs = 60_000, max = 600 } = {}) {
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "anon";
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (buckets.size > 2000) {
      for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
    }
    if (bucket.count > max) {
      return res.status(429).json({ error: "Trop de requêtes, réessayez dans un instant." });
    }
    next();
  };
}

module.exports = { limiter };
