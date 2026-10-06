"use strict";

/** File d'attente légère pour les tâches longues (export EPUB). */

const jobs = new Map();
const MAX_AGE = 45 * 60 * 1000;

function create({ type, title }) {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id,
    type,
    title,
    status: "running",
    progress: 0,
    total: 0,
    message: "Démarrage…",
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  _gc();
  return job;
}

function get(id) {
  return jobs.get(id) || null;
}

function update(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function _gc() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > MAX_AGE) jobs.delete(id);
  }
}

module.exports = { create, get, update };
