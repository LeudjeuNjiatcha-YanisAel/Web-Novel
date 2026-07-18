const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "library.json");

function _read() {
  if (!fs.existsSync(DB_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function _write(entries) {
  fs.writeFileSync(DB_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

function listEntries() {
  return _read();
}

function addEntry(entry) {
  const entries = _read();
  entries.unshift({ ...entry, downloadedAt: new Date().toISOString() });
  _write(entries);
  return entries;
}

module.exports = { listEntries, addEntry };
