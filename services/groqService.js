import Groq from "groq-sdk";
import dotenv from "dotenv";
import { getAvailableSlots } from "./slotsService.js";
import { bookVisit } from "./bookingService.js";
import { searchProperties } from "./propertyService.js";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Sasha, a warm and helpful real estate assistant for Square Fit AI.

LANGUAGE: Always reply in the same language/mix the user uses (Hindi, Hinglish, English, etc.)

YOUR FLOW:
1. User asks about properties → call searchProperties tool → show results
2. User picks a property → call getAvailableSlots → show ONLY 3 slots
3. User picks a slot → ask for name + email in one message
4. You have name + email + slotId → call bookVisit → confirm booking

STRICT RULES:
- NEVER invent properties or slot IDs. Always use tool results exactly.
- NEVER call bookVisit unless you have the EXACT slotId from getAvailableSlots output.
- If searchProperties returns nothing → reply with customer_number "6266221728".
- Keep replies SHORT and conversational. No long paragraphs.

RESPONSE FORMAT — always return valid JSON, no markdown fences:
{
  "message": "short friendly reply",
  "properties": [...],         // include only when showing properties
  "customer_number": "..."     // include only when no properties found
}

Property object shape (use exact values from tool):
{ "id": "...", "name": "...", "price": 4500000, "price_formatted": "₹45L", "location": "...", "bhk": 3 }

When NO properties found:
{ "message": "Sorry, [location] mein koi property nahi mili. Seedha baat karein: 6266221728", "properties": [], "customer_number": "6266221728" }

For booking/slot/conversation replies (no properties to show):
{ "message": "your reply here" }`;

// ─── TOOLS ────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "searchProperties",
      description: "Search real properties from database. Call this for ANY property request.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "Area or city e.g. 'Vijay Nagar'" },
          bhk: { type: "number", description: "Number of BHK e.g. 2" },
          property_type: { type: "string", description: "apartment / villa / plot" },
          max_price: { type: "number", description: "Max price in rupees" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "getAvailableSlots",
      description: "Get visit slots. Call when user wants to book/visit a property.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "bookVisit",
      description: "Book a site visit. Only call when you have slotId (from getAvailableSlots), name, and email.",
      parameters: {
        type: "object",
        properties: {
          slotId: { type: "string", description: "Exact slot ID from getAvailableSlots e.g. '2025-05-10-14'" },
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          notes: { type: "string", description: "Property title and ID" },
        },
        required: ["slotId", "name", "email"],
      },
    },
  },
];

// ─── TOOL HANDLER ─────────────────────────────────────────────────────────────
async function handleToolCall(toolName, toolArgs, sessionId) {
  console.log(`🔧 Tool: ${toolName}`, toolArgs);

  if (toolName === "searchProperties") {
    const result = await searchProperties(toolArgs);
    return JSON.stringify(result);
  }

  if (toolName === "getAvailableSlots") {
    const slots = getAvailableSlots().slice(0, 6); // send 6, model shows 3
    return JSON.stringify({ slots, note: "Show ONLY 3 slots to user at a time. Use exact slot IDs when booking." });
  }

  if (toolName === "bookVisit") {
    // Validate slotId exists before hitting DB
    const validSlots = getAvailableSlots();
    const matchedSlot = validSlots.find((s) => s.id === toolArgs.slotId);
    if (!matchedSlot) {
      console.error("❌ SlotId not found:", toolArgs.slotId);
      return JSON.stringify({
        success: false,
        error: `Slot ID "${toolArgs.slotId}" is invalid. Please ask user to pick a slot again.`,
      });
    }
    const result = await bookVisit({ ...toolArgs, sessionId });
    console.log("📋 Booking result:", result);
    return JSON.stringify(result);
  }

  return JSON.stringify({ error: "Unknown tool" });
}

// ─── EXTRACT JSON FROM LLM RESPONSE ──────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  // Find first { ... } block
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ─── MAIN CHAT FUNCTION ───────────────────────────────────────────────────────
export async function chat(messages, sessionId) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const systemMessage = {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\nToday is ${today}.`,
  };

  let currentMessages = [systemMessage, ...messages];

  for (let i = 0; i < 6; i++) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile", // ← upgraded: 8b was too small for JSON + tools
      messages: currentMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 1024,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    currentMessages.push(assistantMessage);

    // No tool call → final response
    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls) {
      const raw = assistantMessage.content || '{"message":"Main yahan help ke liye hoon!"}';
      // Try to return parsed JSON string so controller can pass it cleanly
      const parsed = extractJSON(raw);
      return parsed ? JSON.stringify(parsed) : raw;
    }

    // Handle tool calls
    const toolResults = [];
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        console.error("❌ Bad tool args JSON:", toolCall.function.arguments);
      }
      const result = await handleToolCall(toolName, toolArgs, sessionId);
      toolResults.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
    currentMessages.push(...toolResults);
  }

  return '{"message":"Kuch issue aa gaya. Please dobara try karein."}';
}