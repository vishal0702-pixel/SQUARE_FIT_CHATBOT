import { v4 as uuidv4 } from "uuid";
import { chat } from "../services/groqService.js";
import {
  ensureSession,
  saveMessage,
  getHistory,
  getContextMessages,
} from "../services/chatHistoryService.js";
import { getAvailableSlots } from "../services/slotsService.js";

/**
 * POST /chat/message
 * Body: { message: string, sessionId?: string }
 */
export async function sendMessage(req, res) {
  try {
    const { message, sessionId: incomingSessionId } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const sessionId = incomingSessionId || uuidv4();
    await ensureSession(sessionId);

    await saveMessage({ sessionId, role: "user", content: message.trim() });

    const contextMessages = await getContextMessages(sessionId, 20);

    // groqService now always returns a JSON string
    const rawReply = await chat(contextMessages, sessionId);

    // Save raw string to DB for history
    await saveMessage({ sessionId, role: "assistant", content: rawReply });

    // Parse JSON for structured frontend response
    let parsed = null;
    try {
      parsed = JSON.parse(rawReply);
    } catch {
      // fallback: wrap plain text in a message object
      parsed = { message: rawReply };
    }

    return res.json({
      sessionId,
      reply: parsed.message || rawReply,         // plain text for simple chat display
      properties: parsed.properties || [],        // array for property cards
      customer_number: parsed.customer_number || null,
      raw: parsed,                                // full object if frontend needs it
    });
  } catch (err) {
    console.error("sendMessage error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

/**
 * GET /chat/history/:sessionId
 */
export async function getChatHistory(req, res) {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }
    const history = await getHistory(sessionId);
    return res.json({ sessionId, messages: history });
  } catch (err) {
    console.error("getChatHistory error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}

/**
 * GET /chat/slots
 */
export async function getSlots(req, res) {
  try {
    const slots = getAvailableSlots();
    return res.json({ slots });
  } catch (err) {
    console.error("getSlots error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
}