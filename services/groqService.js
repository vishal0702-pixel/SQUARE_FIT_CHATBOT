import Groq from "groq-sdk";
import dotenv from "dotenv";
import { getAvailableSlots } from "./slotsService.js";
import { bookVisit } from "./bookingService.js";
import { searchProperties } from "./propertyService.js";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are Nishu, a warm, polite, and helpful real estate assistant for Square Fit AI.

STRICT POLITE TONE & GESTURE RULES:
- Always greet the user respectfully, using "Namaste" or "Hello".
- Use polite gestures in your conversation: refer to the user as "aap" or add "ji" to their name (e.g., "Amit ji", "John ji").
- Show enthusiasm and willingness to help. Use respectful and warm language at all times.
- Act like a caring, helpful broker who respects the customer's choices.

LANGUAGE: Always reply in the same language/mix the user uses (Hindi, Hinglish, English, etc.)

YOUR FLOW:
1. User asks about properties → call searchProperties tool → show results
2. User wants to visit a property → ask casually: "Kab aana chahte hain?"
3. User says anything like "Saturday", "kal", "31 May", "next week" → YOU convert it to YYYY-MM-DD yourself using today's date, then IMMEDIATELY call getAvailableSlots — never ask user for a specific format
4. getAvailableSlots returns slots → show them naturally like "Yeh slots available hain: ..."
5. getAvailableSlots returns empty → say "Us din koi slot available nahi hai, koi aur din batayein?"
6. User picks any slot like "pehla wala", "10 baje wala", "doosra" → call bookVisit with that exact slot_start
7. bookVisit succeeds → "✅ Aapka site visit book ho gaya! [date aur time]"

DATE CONVERSION RULES (use today's date for reference):
- "kal" → tomorrow's date
- "parso" → day after tomorrow
- "Saturday" / "Shanivaar" → next Saturday
- "Sunday" / "Ravivar" → next Sunday
- "31 May" → 2026-05-31
- "next week" → next Monday
- Always convert to YYYY-MM-DD before calling getAvailableSlots

STRICT RULES:
- Always use proper tool call format — never combine tool name and arguments in one string
- bhk must always be a NUMBER not a string e.g. 2 not "2"
- NEVER ask user to type date in any specific format — understand natural language
- NEVER show slots you invented — ONLY show slots from getAvailableSlots tool result
- NEVER ask for name, email, or phone — backend identifies user from token automatically
- NEVER invent slot times — always use exact slot_start values from tool results
- NEVER call bookVisit unless you have exact slot_start ISO string from getAvailableSlots tool
- If bookVisit returns requires_auth=true → say "Pehle login karein, phir booking kar sakte hain"
- If searchProperties returns nothing → reply with customer_number "6266221728"
- Keep replies SHORT and conversational like a friendly assistant

RESPONSE FORMAT — always return valid JSON, no markdown fences:
{
  "message": "short friendly reply",
  "properties": [...],
  "slots": [...],
  "customer_number": "..."
}

Property object shape (use exact values from tool):
{ "id": "...", "name": "...", "price": 4500000, "price_formatted": "Rs45L", "location": "...", "bhk": 3 }

Slot object shape (use exact values from tool):
{ "id": "...", "display": "Saturday, May 31 at 10:00 AM", "slot_start": "2026-05-31T10:00:00.000Z" }

When NO properties found:
{ "message": "Sorry, [location] mein koi property nahi mili. Seedha baat karein: 6266221728", "properties": [], "customer_number": "6266221728" }`;

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
      description:
        "Get real available visit slots from the backend. " +
        "Call ONLY when user wants to visit a property AND you have converted their date to YYYY-MM-DD.",
      parameters: {
        type: "object",
        properties: {
          property_id: {
            type: "string",
            description: "UUID of the property the user wants to visit (from searchProperties result)",
          },
          date: {
            type: "string",
            description: "Date in YYYY-MM-DD format — YOU convert from user's natural language",
          },
        },
        required: ["property_id", "date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bookVisit",
      description:
        "Book a site visit. Only call when you have property_id AND exact slot_start ISO string from getAvailableSlots. " +
        "Do NOT ask for name/email/phone — backend identifies user from login token automatically.",
      parameters: {
        type: "object",
        properties: {
          property_id: {
            type: "string",
            description: "UUID of the property to visit",
          },
          slot_start: {
            type: "string",
            description: "Exact ISO datetime string from getAvailableSlots e.g. '2026-05-31T10:00:00.000Z'",
          },
          user_note: {
            type: "string",
            description: "Optional note from user",
          },
        },
        required: ["property_id", "slot_start"],
      },
    },
  },
];

// ─── TOOL HANDLER ─────────────────────────────────────────────────────────────
async function handleToolCall(toolName, toolArgs, sessionId, userToken) {
  console.log(`🔧 Tool: ${toolName}`, toolArgs);

  if (toolName === "searchProperties") {
    const result = await searchProperties({ ...toolArgs, userToken });
    return JSON.stringify(result);
  }

  if (toolName === "getAvailableSlots") {
    const { property_id, date, branch_id } = toolArgs;

    if (!property_id || !date) {
      return JSON.stringify({ error: "property_id aur date required hain." });
    }

    const slots = await getAvailableSlots({ property_id, date, branch_id, userToken });

    if (!slots.length) {
      return JSON.stringify({
        slots: [],
        note: "Is date pe koi slots nahi hain. User ko koi aur din try karne ko bolein.",
      });
    }

    const limited = slots.slice(0, 6).map((s) => ({
      id: s.id,
      display: s.display,
      slot_start: s.slot_start,
      slot_end: s.slot_end,
      available_officers: s.available_officers,
    }));

    return JSON.stringify({
      slots: limited,
      note: "Show ONLY 3 slots to user. Use exact slot_start ISO string when calling bookVisit.",
    });
  }

  if (toolName === "bookVisit") {
    const { property_id, slot_start, user_note } = toolArgs;

    if (!property_id || !slot_start) {
      return JSON.stringify({ success: false, error: "property_id aur slot_start required hain." });
    }

    const result = await bookVisit({
      property_id,
      slot_start,
      user_note: user_note || null,
      userToken,
    });

    console.log("📋 Booking result:", result);
    return JSON.stringify(result);
  }

  return JSON.stringify({ error: "Unknown tool" });
}

// ─── EXTRACT JSON ─────────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
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
export async function chat(messages, sessionId, userToken) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const systemMessage = {
    role: "system",
    content: `${SYSTEM_PROMPT}\n\nToday is ${today}.`,
  };

  let currentMessages = [systemMessage, ...messages];

  for (let i = 0; i < 6; i++) {
    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: currentMessages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: 1024,
    });

    const choice = response.choices[0];
    const assistantMessage = choice.message;
    currentMessages.push(assistantMessage);

    if (choice.finish_reason !== "tool_calls" || !assistantMessage.tool_calls) {
      const raw = assistantMessage.content || '{"message":"Main yahan help ke liye hoon!"}';
      const parsed = extractJSON(raw);
      return parsed ? JSON.stringify(parsed) : raw;
    }

    const toolResults = [];
    for (const toolCall of assistantMessage.tool_calls) {
      const toolName = toolCall.function.name;
      let toolArgs = {};
      try {
        toolArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        console.error("Bad tool args:", toolCall.function.arguments);
      }
      const result = await handleToolCall(toolName, toolArgs, sessionId, userToken);
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