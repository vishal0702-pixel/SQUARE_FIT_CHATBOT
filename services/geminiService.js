/**
 * geminiService.js — Google Gemini 2.0 Flash
 * FIX: Corrected model name from "gemini-3-flash-preview" → "gemini-2.0-flash"
 * FIX: Pass property city to findNextAvailableSlots to avoid hardcoded city lookup
 * Full flow: search → slots (auto) → book
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { findNextAvailableSlots } from "./slotsService.js";
import { bookVisit } from "./bookingService.js";
import { searchProperties } from "./propertyService.js";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const tools = [
  {
    functionDeclarations: [
      {
        name: "searchProperties",
        description: "Search real properties from database. Call for ANY property request.",
        parameters: {
          type: "OBJECT",
          properties: {
            location: { type: "STRING", description: "City or area e.g. Vijay Nagar, Indore" },
            bhk: { type: "NUMBER", description: "Number of bedrooms e.g. 1, 2, 3, 4" },
            property_type: { type: "STRING", description: "residential, commercial, plot, pg_coliving" },
            max_price: { type: "NUMBER", description: "Max price in rupees" },
          },
        },
      },
      {
        name: "getAvailableSlots",
        description:
          "Get next available visit slots for a property from backend. " +
          "Call IMMEDIATELY when user wants to visit — never ask for date. " +
          "Pass the city from the searchProperties result so the correct branch is found.",
        parameters: {
          type: "OBJECT",
          properties: {
            property_id: {
              type: "STRING",
              description: "Exact UUID of property from searchProperties result",
            },
            city: {
              type: "STRING",
              description: "City of the property from searchProperties result e.g. Indore, Bhopal",
            },
          },
          required: ["property_id"],
        },
      },
      {
        name: "bookVisit",
        description:
          "Book a site visit. Call only when user selects a slot. " +
          "Needs property_id + exact slot_start ISO string from getAvailableSlots.",
        parameters: {
          type: "OBJECT",
          properties: {
            property_id: { type: "STRING", description: "UUID of property" },
            slot_start: {
              type: "STRING",
              description: "Exact ISO datetime from getAvailableSlots e.g. 2026-06-02T03:30:00.000Z",
            },
            user_note: { type: "STRING", description: "Optional note from user" },
          },
          required: ["property_id", "slot_start"],
        },
      },
    ],
  },
];

const SYSTEM_PROMPT = `You are Nishu, a warm, polite, and helpful real estate assistant for Square Fit AI and you are girl  so  reply  like a girl .


STRICT POLITE TONE & GESTURE RULES:
- Always greet the user respectfully, using "Namaste" or "Hello".
- Use polite gestures in your conversation: refer to the user as "aap" or add "ji" to their name (e.g., "Amit ji", "John ji").
- Show enthusiasm and willingness to help. Use respectful and warm language at all times.
- Act like a caring, helpful broker who respects the customer's choices.
if  user  type  in english any  message    so  you  need  to  answer t hem in english  ,
else  if  user  type  any  message  anything  in hinglish (hindi+ english ) so  you need  to  answer  them  or  reply  them  in hinglish 
else  if  if  user   any  message  type  in  hindi  so  reply  them  in hindi 

LANGUAGE: Always reply in the same language the user uses (Hindi, Hinglish, English).

YOUR EXACT FLOW:
1. User asks about properties → call searchProperties → show ALL results from tool
2. User picks a property and wants to visit → IMMEDIATELY call getAvailableSlots with that property_id and city — do NOT ask for date
3. Show slots returned like:
   "Yeh slots available hain:
    1. Tuesday, Jun 3 at 9:00 AM IST
    2. Tuesday, Jun 3 at 10:30 AM IST  
    3. Tuesday, Jun 3 at 11:30 AM IST
    Kaunsa slot choose karein?"
4. If no slots → "Abhi is property ke liye koi slot available nahi hai."
5. User picks slot ("pehla wala", "9 baje", "doosra") → call bookVisit with exact slot_start from getAvailableSlots
6. bookVisit success → "✅ Aapka site visit book ho gaya! [IST time shown]"

STRICT RULES:
- NEVER ask user for date — slots fetched automatically from backend
- NEVER show slots you invented — ONLY show slots from getAvailableSlots tool result
- NEVER add price or any field not in tool result
- NEVER ask for name, email, phone — backend identifies user from login token
- NEVER call bookVisit without exact slot_start from getAvailableSlots
- Show ALL properties returned by searchProperties — do NOT filter or skip any
- Always pass city to getAvailableSlots when you have it from searchProperties
- Keep replies SHORT and friendly

RESPONSE FORMAT — always valid JSON, no markdown:
{
  "message": "short reply",
  "properties": [],
  "slots": [],
  "customer_number": null
}

Property shape (exact values from tool only):
{ "id": "uuid", "name": "title", "location": "area, city", "bhk": 2, "type": "residential", "price_min": "₹50L", "price_max": "₹65L" }

Slot shape (exact values from tool only):
{ "id": "...", "display": "Tuesday, Jun 3 at 9:00 AM IST", "slot_start": "2026-06-03T03:30:00.000Z" }

When NO properties found:
{ "message": "Koi property nahi mili. Seedha baat karein: 6266221728", "properties": [], "customer_number": "6266221728" }

 `;

async function handleToolCall(name, args, userToken) {
  console.log(`🔧 Tool: ${name}`, args);

  if (name === "searchProperties") {
    const result = await searchProperties({ ...args, userToken });
    console.log(`📦 searchProperties: ${result.properties?.length} results`);
    return { json: JSON.stringify(result), slots: null };
  }

  if (name === "getAvailableSlots") {
    const { property_id, city } = args;
    if (!property_id) {
      return { json: JSON.stringify({ error: "property_id required" }), slots: null };
    }
    // FIX: pass city so slotsService doesn't have to guess
    const slots = await findNextAvailableSlots({ property_id, city, userToken });
    console.log(`📅 Slots found: ${slots.length}`);

    if (!slots.length) {
      return {
        json: JSON.stringify({ slots: [], message: "No slots available in next 14 days" }),
        slots: [],
      };
    }

    const limited = slots.slice(0, 3).map((s) => ({
      id: s.id,
      display: s.display,
      slot_start: s.slot_start,
      slot_end: s.slot_end,
    }));

    console.log(`📅 Returning slots:`, JSON.stringify(limited));
    return { json: JSON.stringify({ slots: limited }), slots: limited };
  }

  if (name === "bookVisit") {
    const { property_id, slot_start, user_note } = args;
    if (!property_id || !slot_start) {
      return {
        json: JSON.stringify({ success: false, error: "property_id and slot_start required" }),
        slots: null,
      };
    }
    const result = await bookVisit({
      property_id,
      slot_start,
      user_note: user_note || null,
      userToken,
    });
    console.log("📋 Booking result:", result);
    return { json: JSON.stringify(result), slots: null };
  }

  return { json: JSON.stringify({ error: "Unknown tool" }), slots: null };
}

function extractJSON(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); }
  catch { return null; }
}

export async function chat(messages, sessionId, userToken) {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  // FIX: was "gemini-3-flash-preview" which does not exist
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `${SYSTEM_PROMPT}\n\nToday is ${today}.`,
    tools,
    generationConfig: { temperature: 0.2 },
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const lastMessage = messages[messages.length - 1];
  const chatSession = model.startChat({ history });
  let response = await chatSession.sendMessage(lastMessage?.content || "");
  let lastSlots = null;

  for (let i = 0; i < 6; i++) {
    const candidate = response.response.candidates[0];
    const parts = candidate.content.parts;
    const toolCallParts = parts.filter((p) => p.functionCall);

    if (!toolCallParts.length) {
      const text = response.response.text();
      const parsed = extractJSON(text) || { message: text };
      if (lastSlots !== null) parsed.slots = lastSlots;
      return JSON.stringify(parsed);
    }

    const toolResponseParts = [];
    for (const part of toolCallParts) {
      const { name, args } = part.functionCall;
      const { json, slots } = await handleToolCall(name, args, userToken);
      if (slots !== null) lastSlots = slots;
      toolResponseParts.push({
        functionResponse: { name, response: JSON.parse(json) },
      });
    }
    response = await chatSession.sendMessage(toolResponseParts);
  }

  return '{"message":"Kuch issue aa gaya. Please dobara try karein."}';
}