const sessions = {};

export function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      messages: [],
      lastProperties: [],
    };
  }
  return sessions[userId];
}