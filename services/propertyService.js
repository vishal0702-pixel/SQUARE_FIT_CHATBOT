/**
 * propertyService.js
 * FIX: Switched from /api/v1/properties/recommended to /api/v1/properties/list
 *      because getRecommendedProperties uses sql.join() which does not exist in
 *      the `postgres` (postgres.js) library — it throws at runtime for any
 *      filtered query. listProperty uses plain tagged-template sql which works fine.
 *
 * All filtering (city, bhk, type, price, status) is now done on the chatbot side
 * after fetching up to 200 records from the working endpoint.
 */

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3002";

export async function searchProperties({ location, bhk, property_type, max_price, userToken } = {}) {
  try {
    // Fetch a large batch — listProperty takes a `limit` query param
    const params = new URLSearchParams({ limit: "200" });

    const headers = { "Content-Type": "application/json" };
    if (userToken) headers["Authorization"] = `Bearer ${userToken}`;

    const res = await fetch(`${BACKEND_URL}/api/v1/properties/list?${params}`, { headers });
    const text = await res.text();

    let json;
    try { json = JSON.parse(text); }
    catch {
      console.error("Properties API non-JSON:", text.slice(0, 200));
      return { properties: [] };
    }

    if (!res.ok) {
      console.error("Properties API error:", json);
      return { properties: [] };
    }

    let results = json.data || [];
    console.log(`📦 Total properties from API: ${results.length}`);

    // --- Chatbot-side filtering ---

    // Status: keep published or unset
    results = results.filter((p) => !p.status || p.status === "published");

    // City must exist and not be a placeholder
    results = results.filter((p) => p.city && p.city !== "TBD");

    // Location: match city or area (case-insensitive)
    if (location) {
      const loc = location.toLowerCase();
      results = results.filter(
        (p) =>
          p.city?.toLowerCase().includes(loc) ||
          p.area?.toLowerCase().includes(loc)
      );
    }

    // BHK / bedrooms
    if (bhk) {
      results = results.filter((p) => Number(p.bedrooms) === Number(bhk));
    }

    // Property type
    if (property_type) {
      results = results.filter(
        (p) => p.type?.toLowerCase() === property_type.toLowerCase()
      );
    }

    // Max price — compare against min_price so even budget properties show up
    if (max_price) {
      results = results.filter(
        (p) => !p.min_price || parseFloat(p.min_price) <= parseFloat(max_price)
      );
    }

    console.log(`✅ After filtering: ${results.length}`);

    const properties = results.slice(0, 8).map((p) => ({
      id: p.id,
      name: p.title,
      location: `${p.area || ""}, ${p.city}`.replace(/^,\s*/, ""),
      city: p.city,          // forwarded to getAvailableSlots for branch lookup
      bhk: p.bedrooms,
      type: p.type,
      listing_type: p.listing_type,
      area_sqft: p.total_area_sqft,
      price_min: p.min_price ? formatPrice(p.min_price) : null,
      price_max: p.max_price ? formatPrice(p.max_price) : null,
    }));

    return { properties };
  } catch (err) {
    console.error("searchProperties error:", err.message);
    return { properties: [] };
  }
}

function formatPrice(price) {
  if (!price) return null;
  const p = parseFloat(price);
  if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)}Cr`;
  if (p >= 100000)   return `₹${(p / 100000).toFixed(0)}L`;
  return `₹${p}`;
}