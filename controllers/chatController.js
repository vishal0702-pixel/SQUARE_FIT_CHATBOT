import { v4 as uuidv4 } from "uuid";
import { chat } from "../services/geminiService.js";
import {
  ensureSession,
  saveMessage,
  getHistory,
  getContextMessages,
} from "../services/chatHistoryService.js";
import supabase from "../config/db.js";

// Decode custom JWT to get user id
function getUserIdFromToken(token) {
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString("utf8"));
    return payload.id || payload.sub || null;
  } catch {
    return null;
  }
}

export async function sendMessage(req, res) {
  try {
    const { message, sessionId: incomingSessionId } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const authHeader = req.headers.authorization || "";
    const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const sessionId = incomingSessionId || uuidv4();
    await ensureSession(sessionId);
    await saveMessage({ sessionId, role: "user", content: message.trim(), userToken });

    const contextMessages = await getContextMessages(sessionId, 20);
    const rawReply = await chat(contextMessages, sessionId, userToken);

    await saveMessage({ sessionId, role: "assistant", content: rawReply, userToken });

    let parsed;
    try { parsed = JSON.parse(rawReply); }
    catch { parsed = { message: rawReply }; }

    return res.json({
      sessionId,
      reply: parsed.message || rawReply,
      properties: parsed.properties || [],
      slots: parsed.slots || [],
      customer_number: parsed.customer_number || null,
      raw: parsed,
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

export async function getChatHistory(req, res) {
  try {
    const { sessionId } = req.params;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required." });
    const history = await getHistory(sessionId);
    return res.json({ sessionId, messages: history });
  } catch (err) {
    console.error("getChatHistory error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

export async function getUserChatHistory(req, res) {
  try {
    const authHeader = req.headers.authorization || "";
    const userToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!userToken) {
      return res.status(401).json({ error: "Unauthorized. Login token required." });
    }

    // Decode token directly — no Supabase auth needed
    const userId = getUserIdFromToken(userToken);
    console.log("👤 getUserChatHistory: userId =", userId);

    if (!userId) {
      return res.status(401).json({ error: "Could not extract user id from token." });
    }

    // Query directly from supabase
    const { data, error } = await supabase
      .from("chat_messages")
      .select("session_id, role, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("❌ DB error:", error.message);
      return res.status(500).json({ error: "Database error." });
    }

    console.log(`✅ Found ${data?.length} messages for userId=${userId}`);

    // Group by session_id
    const sessions = {};
    for (const msg of data || []) {
      if (!sessions[msg.session_id]) {
        sessions[msg.session_id] = [];
      }
      sessions[msg.session_id].push({
        role: msg.role,
        content: msg.content,
        created_at: msg.created_at,
      });
    }

    return res.json({ userId, totalMessages: data?.length, sessions });

  } catch (err) {
    console.error("getUserChatHistory error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}