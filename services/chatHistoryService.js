import supabase from "../config/db.js";

// Decode custom JWT to get user id
function getUserIdFromToken(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    const userId = payload.id || payload.sub || null;
    console.log("✅ getUserIdFromToken:", userId);
    return userId;
  } catch {
    console.error("❌ getUserIdFromToken: failed to decode token");
    return null;
  }
}

export async function ensureSession(sessionId) {
  return;
}

export async function saveMessage({ sessionId, role, content, userToken = null }) {
  const userId = getUserIdFromToken(userToken);
  const textContent = typeof content === "string" ? content : JSON.stringify(content);

  const { error } = await supabase
    .from("chat_messages")
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: role,
      content: textContent,
    });

  if (error) {
    console.error(`❌ saveMessage error:`, error.message);
  } else {
    console.log(`✅ saveMessage saved (session=${sessionId}, userId=${userId})`);
  }
}

export async function getHistory(sessionId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`❌ getHistory error:`, error.message);
    return [];
  }
  return data || [];
}

export async function getContextMessages(sessionId, limit = 20) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`❌ getContextMessages error:`, error.message);
    return [];
  }

  return (data || []).slice(-limit).map((m) => ({ role: m.role, content: m.content }));
}

export async function getUserHistory(userToken) {
  const userId = getUserIdFromToken(userToken);

  if (!userId) {
    console.error("❌ getUserHistory: No userId found in token");
    return [];
  }

  console.log(`🔍 getUserHistory: querying for userId=${userId}`);

  const { data, error } = await supabase
    .from("chat_messages")
    .select("session_id, role, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`❌ getUserHistory error:`, error.message);
    return [];
  }

  console.log(`✅ getUserHistory: found ${data?.length} messages`);
  return data || [];
}