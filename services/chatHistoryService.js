// In-memory chat history — no Supabase needed
const store = {};

export async function ensureSession(sessionId) {
  if (!store[sessionId]) store[sessionId] = [];
}

export async function saveMessage({ sessionId, role, content }) {
  if (!store[sessionId]) store[sessionId] = [];
  store[sessionId].push({ role, content, created_at: new Date() });
}

export async function getHistory(sessionId) {
  return store[sessionId] || [];
}

export async function getContextMessages(sessionId, limit = 20) {
  const history = store[sessionId] || [];
  return history.slice(-limit).map((m) => ({ role: m.role, content: m.content }));
}