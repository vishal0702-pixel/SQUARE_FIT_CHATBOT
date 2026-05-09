import supabase from "../config/db.js";

/**
 * Search properties by location, bhk, type, price etc.
 */
export async function searchProperties({ location, bhk, property_type, max_price } = {}) {
  let query = supabase
    .from("properties")
    .select("id, title, bhk, price, location, description, property_type, agent_id, created_at")
    .order("created_at", { ascending: false });

  if (location) {
    query = query.ilike("location", `%${location}%`);
  }
  if (bhk) {
    query = query.eq("bhk", bhk);
  }
  if (property_type) {
    query = query.ilike("property_type", `%${property_type}%`);
  }
  if (max_price) {
    query = query.lte("price", max_price);
  }

  const { data, error } = await query.limit(5);

  if (error) {
    console.error("Property search error:", error);
    return { properties: [], error: "Failed to fetch properties." };
  }

  return { properties: data || [] };
}

/**
 * Get a single property by ID
 */
export async function getPropertyById(id) {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;
  return data;
}