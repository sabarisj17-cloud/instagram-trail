const fs = require("fs");
const path = require("path");

const DEDUPLICATION_TTL_MS = 30 * 60 * 1000;
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

const PROCESSED_MESSAGES_FILE = path.join(__dirname, "..", "data", "processed_messages.json");
const SESSIONS_FILE = path.join(__dirname, "..", "data", "conversation_sessions.json");

const processedMessages = new Map();
const conversationStore = new Map();

function initProcessedMessages() {
  try {
    const dir = path.dirname(PROCESSED_MESSAGES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(PROCESSED_MESSAGES_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_MESSAGES_FILE, "utf8"));
      if (Array.isArray(data)) {
        const now = Date.now();
        for (const item of data) {
          if (item && item.id && item.time && now - item.time < DEDUPLICATION_TTL_MS) {
            processedMessages.set(item.id, item.time);
          }
        }
      }
    }
  } catch (err) {
    console.error("[Processed Messages] Error initializing store:", err.message);
  }
}
initProcessedMessages();

function saveProcessedMessagesToDisk() {
  try {
    const entries = [];
    const now = Date.now();
    for (const [id, time] of processedMessages.entries()) {
      if (now - time < DEDUPLICATION_TTL_MS) {
        entries.push({ id, time });
      }
    }
    fs.writeFileSync(PROCESSED_MESSAGES_FILE, JSON.stringify(entries.slice(-1000)), "utf8");
  } catch (err) {
    // Non-critical
  }
}

function initSessions() {
  try {
    const dir = path.dirname(SESSIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
      if (data && typeof data === "object") {
        const now = Date.now();
        for (const [phone, sess] of Object.entries(data)) {
          if (sess && now - (sess.lastUpdated || 0) < CONVERSATION_TTL_MS) {
            conversationStore.set(phone, sess);
          }
        }
      }
    }
  } catch (err) {
    console.error("[Sessions] Error initializing store:", err.message);
  }
}
initSessions();

function saveSessionsToDisk() {
  try {
    const obj = {};
    const now = Date.now();
    for (const [phone, sess] of conversationStore.entries()) {
      if (now - (sess.lastUpdated || 0) < CONVERSATION_TTL_MS) {
        obj[phone] = sess;
      }
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), "utf8");
  } catch (err) {
    // Non-critical
  }
}

/**
 * Check if a WhatsApp message ID has already been processed (Deduplication)
 */
function isDuplicateMessage(messageId) {
  if (!messageId) return false;
  const now = Date.now();

  for (const [id, time] of processedMessages.entries()) {
    if (now - time > DEDUPLICATION_TTL_MS) {
      processedMessages.delete(id);
    }
  }

  if (processedMessages.has(messageId)) {
    return true;
  }

  processedMessages.set(messageId, now);
  saveProcessedMessagesToDisk();
  return false;
}

/**
 * Get conversation state for a phone number
 */
function getConversationState(phone) {
  if (!phone) return { step: "NEW", lastUpdated: Date.now() };
  const now = Date.now();
  const sess = conversationStore.get(phone);
  if (sess && now - (sess.lastUpdated || 0) < CONVERSATION_TTL_MS) {
    return sess;
  }
  const fresh = { step: "NEW", lastUpdated: now };
  conversationStore.set(phone, fresh);
  return fresh;
}

/**
 * Update conversation state for a phone number
 */
function updateConversationState(phone, step) {
  if (!phone) return null;
  const updated = { step, lastUpdated: Date.now() };
  conversationStore.set(phone, updated);
  saveSessionsToDisk();
  return updated;
}

function clearAllSessions() {
  conversationStore.clear();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify({}), "utf8");
    }
  } catch (err) {}
}

module.exports = {
  isDuplicateMessage,
  getConversationState,
  updateConversationState,
  clearAllSessions
};
