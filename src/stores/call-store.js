// In-memory store: ultravoxCallId → { phoneNumber, patientId, appointment }
// Entries are created on first tool call and removed when the call ends.

const store = new Map();

function upsert(callId, patch) {
  store.set(callId, { ...(store.get(callId) ?? {}), ...patch });
}

function get(callId) {
  return store.get(callId) ?? null;
}

function remove(callId) {
  store.delete(callId);
}

function size() {
  return store.size;
}

module.exports = { upsert, get, remove, size };
