import { v4 as uuidv4 } from "uuid";
import { chat } from "../services/geminiService.js";
import {
  ensureSession,
  saveMessage,
  getHistory,
  getContextMessages,
} from "../services/chatHistoryService.js";

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
    await saveMessage({ sessionId, role: "user", content: message.trim() });

    const contextMessages = await getContextMessages(sessionId, 20);
    const rawReply = await chat(contextMessages, sessionId, userToken);

    await saveMessage({ sessionId, role: "assistant", content: rawReply });

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