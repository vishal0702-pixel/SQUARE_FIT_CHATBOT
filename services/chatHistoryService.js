import supabase from "../config/db.js";

/**
 * Ensures a chat session exists, creates if not.
 */
export async function ensureSession(sessionId) {
  const { data: existing } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .maybeSingle();

  if (!existing) {
    await supabase.from("chat_sessions").insert({ id: sessionId });
  }
}

/**
 * Saves a message to the database.
 */
export async function saveMessage({ sessionId, role, content }) {
  const { error } = await supabase.from("messages").insert({
    session_id: sessionId,
    role,
    content,
  });

  if (error) {
    console.error("Error saving message:", error);
  }
}

/**
 * Loads full chat history for a session.
 */
export async function getHistory(sessionId) {
  const { data, error } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching history:", error);
    return [];
  }

  return data || [];
}

/**
 * Returns last N messages for LLM context (excludes tool/system messages).
 */
export async function getContextMessages(sessionId, limit = 20) {
  const history = await getHistory(sessionId);
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}