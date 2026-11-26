const fs = require("fs");
const path = require("path");

const DEDUPLICATION_TTL_MS = 30 * 60 * 1000;
const PROCESSED_MESSAGES_FILE = path.join(__dirname, "..", "data", "processed_messages.json");
const processedMessages = new Map();

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

module.exports = {
  isDuplicateMessage
};
