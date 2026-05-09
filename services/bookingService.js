import supabase from "../config/db.js";
import { getAvailableSlots } from "./slotsService.js";

export async function bookVisit({ sessionId, slotId, name, email, phone = null, notes = null }) {
  // 1. Validate slot exists
  const availableSlots = getAvailableSlots();
  const slot = availableSlots.find((s) => s.id === slotId);

  if (!slot) {
    console.error("❌ Invalid slotId:", slotId, "| Valid:", availableSlots.map(s=>s.id).slice(0,5));
    return {
      success: false,
      error: `Invalid slot selected. Please choose from the available slots.`,
    };
  }

  // 2. Check if slot already booked
  const { data: existing } = await supabase
    .from("bookings")
    .select("id")
    .eq("slot_id", slotId)
    .eq("status", "confirmed")
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `Yeh slot already book hai: "${slot.display}". Koi aur slot choose karein.`,
    };
  }

  // 3. Insert — session_id is nullable so no FK issue even if session doesn't exist
  const insertData = {
    slot_id: slotId,
    slot_date: slot.date,
    slot_time: slot.timeLabel,
    slot_display: slot.display,
    name,
    email,
    phone,
    notes,
    status: "confirmed",
  };

  // Only attach session_id if it looks like a valid UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (sessionId && uuidRegex.test(sessionId)) {
    insertData.session_id = sessionId;
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error("❌ Booking insert error:", error.message, error.details, error.hint);
    return { success: false, error: "Booking save nahi hui. Please dobara try karein." };
  }

  console.log("✅ Booking saved:", data.id);

  return {
    success: true,
    booking: {
      id: data.id,
      property: notes || "Property Visit",
      slot: slot.display,
      name,
      email,
      phone,
    },
    message: `✅ Booking confirmed!\n📅 ${slot.display}\n👤 ${name}\n📧 ${email}${phone ? `\n📞 ${phone}` : ""}\nBooking ID: ${data.id}`,
  };
}