/**
 * slotsService.js
 * FIX: Dynamically looks up property city instead of hardcoding "Indore".
 * FIX: Exports both findNextAvailableSlots (used by geminiService)
 *      and getAvailableSlots (used by groqService).
 * Correct URLs: /api/v1/branches, /api/v1/slots
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3002";

/**
 * Fetch the city for a given property_id from the backend.
 * Calls GET /api/v1/properties/recommended?limit=1 won't work for a single property,
 * so we rely on a small helper that hits the visits/branches flow after resolving city
 * from the property list endpoint — or we accept city as an optional param.
 *
 * Since the backend exposes /api/v1/properties/recommended?city=... and the property
 * object returned by searchProperties already contains location ("area, city"), the
 * cleanest fix is to accept an optional `city` param and fall back to a property lookup.
 */
async function getCityForProperty(property_id, userToken) {
  // The recommended endpoint supports no id-based lookup, but we can search all
  // and find the match. A lighter approach: the AI already knows the city from
  // searchProperties results — so we accept it as an optional param.
  // As a last resort, default to first branch city returned by the backend.
  const headers = {
    "Content-Type": "application/json",
    ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
  };

  // Try fetching all published properties to find this property's city
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/v1/properties/list?limit=200`,
      { headers }
    );
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { return null; }
    const found = (json.data || []).find((p) => p.id === property_id);
    return found?.city || null;
  } catch {
    return null;
  }
}

/**
 * Used by geminiService — auto-picks date (next 14 days), no date param needed.
 * Accepts optional `city` so the AI can pass it from searchProperties result.
 */
export async function findNextAvailableSlots({ property_id, city, userToken } = {}) {
  if (!property_id) return [];

  const headers = {
    "Content-Type": "application/json",
    ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
  };

  try {
    // Resolve city if not provided
    const resolvedCity = city || await getCityForProperty(property_id, userToken);
    if (!resolvedCity) {
      console.error("Could not resolve city for property", property_id);
      return [];
    }

    // Step 1 — get branch for resolved city
    const branchRes = await fetch(
      `${BACKEND_URL}/api/v1/branches?city=${encodeURIComponent(resolvedCity)}`,
      { headers }
    );
    const branchText = await branchRes.text();
    console.log(`🔍 Branch status: ${branchRes.status} url: ${BACKEND_URL}/api/v1/branches?city=${encodeURIComponent(resolvedCity)}`);
    console.log(`🔍 Branch response: ${branchText.slice(0, 300)}`);
    let branchJson;
    try { branchJson = JSON.parse(branchText); }
    catch { console.error("Branch API non-JSON:", branchText.slice(0, 100)); return []; }

    const branch = branchJson.data?.[0];
    if (!branch) {
      console.error(`No branch found for city: ${resolvedCity}`);
      return [];
    }
    console.log(`🏢 Branch: ${branch.name} (${branch.id}) in ${resolvedCity}`);

    // Step 2 — loop next 14 days for first available slots
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const date = d.toISOString().split("T")[0];

      const params = new URLSearchParams({ property_id, date, branch_id: branch.id });
      const slotsRes = await fetch(
        `${BACKEND_URL}/api/v1/slots?${params}`,
        { headers }
      );

      const slotsText = await slotsRes.text();
      let slotsJson;
      try { slotsJson = JSON.parse(slotsText); }
      catch { console.error(`Slots non-JSON on ${date}:`, slotsText.slice(0, 100)); continue; }

      if (slotsJson.success && Array.isArray(slotsJson.data) && slotsJson.data.length > 0) {
        console.log(`✅ Found ${slotsJson.data.length} slots on ${date}`);
        return slotsJson.data.slice(0, 6).map((slot) => {
          const start = new Date(slot.slot_start);
          const utcHour = start.getUTCHours();
          const utcMin = start.getUTCMinutes();
          // Convert UTC to IST (+5:30)
          const istTotal = utcHour * 60 + utcMin + 330;
          const istHour = Math.floor(istTotal / 60) % 24;
          const istMin = istTotal % 60;
          const dayName = start.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
          const displayDate = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
          return {
            id: `${date}-${utcHour}`,
            date,
            slot_start: slot.slot_start,
            slot_end: slot.slot_end,
            display: `${dayName}, ${displayDate} at ${formatTime(istHour, istMin)} IST`,
            available_officers: slot.available_officers,
          };
        });
      }
    }

    console.log("No slots found in next 14 days");
    return [];
  } catch (err) {
    console.error("findNextAvailableSlots error:", err.message);
    return [];
  }
}

/**
 * Used by groqService — caller provides an explicit date (YYYY-MM-DD).
 * Also accepts optional city to avoid an extra lookup.
 */
export async function getAvailableSlots({ property_id, date, branch_id, city, userToken } = {}) {
  if (!property_id || !date) return [];

  const headers = {
    "Content-Type": "application/json",
    ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}),
  };

  try {
    // Resolve branch_id if not provided
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId) {
      const resolvedCity = city || await getCityForProperty(property_id, userToken);
      if (!resolvedCity) {
        console.error("Could not resolve city for property", property_id);
        return [];
      }

      const branchRes = await fetch(
        `${BACKEND_URL}/api/v1/branches?city=${encodeURIComponent(resolvedCity)}`,
        { headers }
      );
      const branchJson = await branchRes.json().catch(() => null);
      const branch = branchJson?.data?.[0];
      if (!branch) {
        console.error(`No branch found for city: ${resolvedCity}`);
        return [];
      }
      resolvedBranchId = branch.id;
      console.log(`🏢 Branch resolved: ${branch.name} (${resolvedBranchId})`);
    }

    const params = new URLSearchParams({ property_id, date, branch_id: resolvedBranchId });
    const slotsRes = await fetch(
      `${BACKEND_URL}/api/v1/slots?${params}`,
      { headers }
    );

    const slotsText = await slotsRes.text();
    let slotsJson;
    try { slotsJson = JSON.parse(slotsText); }
    catch { console.error(`Slots non-JSON:`, slotsText.slice(0, 100)); return []; }

    if (!slotsJson.success || !Array.isArray(slotsJson.data)) return [];

    return slotsJson.data.map((slot) => {
      const start = new Date(slot.slot_start);
      const utcHour = start.getUTCHours();
      const utcMin = start.getUTCMinutes();
      const istTotal = utcHour * 60 + utcMin + 330;
      const istHour = Math.floor(istTotal / 60) % 24;
      const istMin = istTotal % 60;
      const dayName = start.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
      const displayDate = start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      return {
        id: `${date}-${utcHour}`,
        date,
        slot_start: slot.slot_start,
        slot_end: slot.slot_end,
        display: `${dayName}, ${displayDate} at ${formatTime(istHour, istMin)} IST`,
        available_officers: slot.available_officers,
      };
    });
  } catch (err) {
    console.error("getAvailableSlots error:", err.message);
    return [];
  }
}

function formatTime(hour, minute) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:${minute.toString().padStart(2, "0")} ${suffix}`;
}