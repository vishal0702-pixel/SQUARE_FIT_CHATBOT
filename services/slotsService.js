/**
 * Generates available time slots for the next 7 days.
 * Business hours: 10:00 AM – 6:00 PM, slots every 1 hour.
 * Excludes Sundays.
 */

const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17]; // 10am to 5pm

export function getAvailableSlots() {
  const slots = [];
  const now = new Date();

  for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
    const date = new Date(now);
    date.setDate(now.getDate() + dayOffset);

    // Skip Sundays (0)
    if (date.getDay() === 0) continue;

    const dateStr = date.toISOString().split("T")[0]; // YYYY-MM-DD
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    const displayDate = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });

    SLOT_HOURS.forEach((hour) => {
      const label = formatHour(hour);
      slots.push({
        id: `${dateStr}-${hour}`,
        date: dateStr,
        dayName,
        displayDate,
        hour,
        timeLabel: label,
        display: `${dayName}, ${displayDate} at ${label}`,
      });
    });
  }

  return slots;
}

function formatHour(hour) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour;
  return `${h}:00 ${suffix}`;
}