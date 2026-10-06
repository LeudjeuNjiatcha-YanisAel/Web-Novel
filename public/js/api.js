// NovelHub — couche réseau

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Erreur ${res.status}`, res.status);
  }
  return data;
}

function qs(params) {
  const parts = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export const api = {
  health: () => request("/api/health"),

  search: (params) => request("/api/search" + qs(params)),
  genres: () => request("/api/genres"),
  stats: () => request("/api/stats"),

  extensions: () => request("/api/extensions"),
  toggleExtension: (id, enabled) =>
    request(`/api/extensions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  novel: (sourceId, novelId) => request(`/api/sources/${sourceId}/novels/${novelId}`),
  chapter: (sourceId, novelId, chapterId) =>
    request(`/api/sources/${sourceId}/novels/${novelId}/chapters/${chapterId}`),

  exportEpub: (sourceId, novelId, from, to) =>
    request(`/api/sources/${sourceId}/novels/${novelId}/export`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    }),
  job: (jobId) => request(`/api/jobs/${jobId}`),

  library: () => request("/api/library"),
  deleteLibraryEntry: (id) =>
    request(`/api/library/${id}`, { method: "DELETE" }),

  getState: () => request("/api/state"),
  putState: (patch) =>
    request("/api/state", { method: "PUT", body: JSON.stringify(patch) }),
  resetState: () => request("/api/state", { method: "DELETE" }),
};