/**
 * bookingService.js
 * POST /api/v1/ — visitRoutes mounted at /api/v1 with router.post('/')
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3002";

export async function bookVisit({ property_id, slot_start, user_note = null, userToken }) {
  if (!property_id || !slot_start) {
    return { success: false, error: "property_id aur slot_start required hain." };
  }

  if (!userToken) {
    return {
      success: false,
      error: "Booking ke liye login required hai. Please pehle login karein.",
      requires_auth: true,
    };
  }

  const body = { property_id, slot_start };
  if (user_note) body.user_note = user_note;

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch {
      console.error("Booking API non-JSON:", text.slice(0, 200));
      return { success: false, error: "Server error" };
    }

    if (!res.ok || !json.success) {
      console.error("❌ Booking API error:", json.message);
      return { success: false, error: json.message || "Booking fail ho gayi. Dobara try karein." };
    }

    const visit = json.data;
    console.log("✅ Visit booked:", visit.id);

    // Convert UTC to IST for display
    const slotIST = new Date(visit.slot_start).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      success: true,
      booking: {
        id: visit.id,
        property_id: visit.property_id,
        slot_start: visit.slot_start,
        slot_end: visit.slot_end,
        status: visit.status,
      },
      message: `✅ Site visit booked!\n📅 ${slotIST}\n🆔 Booking ID: ${visit.id}\n📋 Status: ${visit.status}`,
    };
  } catch (err) {
    console.error("❌ bookVisit fetch error:", err.message);
    return { success: false, error: "Server se connect nahi ho paya. Please dobara try karein." };
  }
}