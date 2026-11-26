const googleSheetService = require("../services/googleSheetService");
const whatsappService = require("../services/whatsappService");
const {
  isDuplicateMessage,
  getConversationState,
  updateConversationState
} = require("../utils/conversationState");

const SPROUT_WELCOME_REPLY = [
  "Hello 👋 Thank you for contacting Sprout.",
  "Kindly provide the following information:",
  "Name:",
  "Location:",
  "Reason for contacting:",
  "",
  "Our representative will contact you shortly with complete details."
].join("\n");

const SPROUT_CONFIRMATION_REPLY =
  "Thank you for contacting Sprout. Our representative will contact you shortly with complete details.";

const GREETING_WORDS = new Set([
  "hi",
  "hai",
  "hii",
  "hiii",
  "hello",
  "helo",
  "hey",
  "good morning",
  "good afternoon",
  "good evening",
  "namaste",
  "vanakkam",
  "start",
  "menu"
]);

/**
 * Extract readable text from an incoming WhatsApp message object
 */
function extractMessageText(message) {
  switch (message.type) {
    case "text":
      return message.text?.body || "";
    case "image":
      return message.image?.caption || "";
    case "video":
      return message.video?.caption || "";
    case "button":
      return message.button?.text || "";
    case "interactive":
      return (
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        ""
      );
    default:
      return "";
  }
}

/**
 * Parse Name, Location, and Reason from user's reply (labeled, multi-line, comma-separated, or free text)
 */
function parseUserDetails(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return null;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let name = "";
  let location = "";
  let reason = "";
  let hasLabels = false;

  for (const line of lines) {
    if (/^name\s*[:-]\s*/i.test(line)) {
      name = line.replace(/^name\s*[:-]\s*/i, "").trim();
      hasLabels = true;
    } else if (/^(location|city|place)\s*[:-]\s*/i.test(line)) {
      location = line.replace(/^(location|city|place)\s*[:-]\s*/i, "").trim();
      hasLabels = true;
    } else if (/^(reason(\s*for\s*contacting)?|details|purpose|enquiry|inquiry)\s*[:-]\s*/i.test(line)) {
      reason = line
        .replace(/^(reason(\s*for\s*contacting)?|details|purpose|enquiry|inquiry)\s*[:-]\s*/i, "")
        .trim();
      hasLabels = true;
    }
  }

  if (hasLabels) {
    return {
      name,
      location,
      reason: reason || (!name && !location ? text : ""),
      isStructured: true
    };
  }

  // Multi-line format like:
  // sabari
  // cbe
  // banking
  if (lines.length >= 2) {
    name = lines[0];
    location = lines[1];
    reason = lines.slice(2).join(" | ");
    return { name, location, reason, isStructured: true };
  }

  // Comma-separated format like: "sabari, cbe, banking"
  const parts = text
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    name = parts[0];
    location = parts[1];
    reason = parts.slice(2).join(", ");
    return { name, location, reason, isStructured: true };
  }

  // Single free-text detail message
  return { name: "", location: "", reason: text, isStructured: false };
}

/**
 * Handle Meta Webhook Verification (GET /webhook)
 */
function verifyWebhook(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const VERIFY_TOKEN =
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
    process.env.WHATSAPP_VERIFY_TOKEN ||
    "sproutks_webhook_verify_token_2026";

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("WhatsApp webhook verified successfully");
      return res.status(200).send(challenge);
    }
    console.warn("WhatsApp webhook verification failed: token mismatch");
    return res.sendStatus(403);
  }

  return res.sendStatus(400);
}

/**
 * Handle Incoming WhatsApp Messages (POST /webhook)
 * 1. First contact / greeting: stores phone + date + time and asks for Name, Location, Reason.
 * 2. When user replies with details: saves Name, Location, Reason (+ phone, date, time) and sends confirmation.
 */
async function handleWebhook(req, res) {
  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body;
    if (!body || body.object !== "whatsapp_business_account") {
      return;
    }

    const value = body.entry?.[0]?.changes?.[0]?.value;
    if (!value || !Array.isArray(value.messages) || value.messages.length === 0) {
      return;
    }

    const botPhone = (process.env.WHATSAPP_PHONE_NUMBER || "+917010472311").replace(/\D/g, "");
    const targetSuffix = botPhone.slice(-10) || "7010472311";
    const configuredPhoneId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "1373840235818636").trim();
    const metadataPhoneDigits = String(value.metadata?.display_phone_number || "").replace(/\D/g, "");
    const metadataPhoneId = String(value.metadata?.phone_number_id || "").trim();
    const isTargetNumber =
      metadataPhoneDigits.length >= 7
        ? metadataPhoneDigits.endsWith(targetSuffix) || (metadataPhoneId && metadataPhoneId === configuredPhoneId)
        : !metadataPhoneId || metadataPhoneId === configuredPhoneId;

    if (!isTargetNumber) {
      return;
    }

    for (const message of value.messages) {
      const messageId = message.id;
      const from = String(message.from || "").replace(/\D/g, "");
      const timestamp = Number(message.timestamp);

      if (!from) {
        continue;
      }

      if (isDuplicateMessage(messageId)) {
        console.log(`[Duplicate Dropped] Message ID ${messageId}`);
        continue;
      }

      if (timestamp) {
        const ageSec = Math.floor(Date.now() / 1000) - timestamp;
        if (ageSec > 300) {
          console.log(`[Stale Message Dropped] Message ID ${messageId} (${ageSec}s old)`);
          continue;
        }
      }

      if (botPhone && from === botPhone) {
        console.log(`[Self Message Dropped] +${from}`);
        continue;
      }

      const rawText = extractMessageText(message);
      const normalizedText = rawText.trim().toLowerCase();
      const isGreeting = !rawText.trim() || GREETING_WORDS.has(normalizedText);
      const state = getConversationState(from);
      const parsed = parseUserDetails(rawText);

      // Treat as user details if they've already been prompted (or submitted structured details even after a server restart)
      const isDetailsSubmission =
        !isGreeting &&
        parsed &&
        (state.step === "AWAITING_DETAILS" ||
          state.step === "DETAILS_SUBMITTED" ||
          parsed.isStructured);

      if (isDetailsSubmission) {
        updateConversationState(from, "DETAILS_SUBMITTED");
        await Promise.allSettled([
          googleSheetService.recordUserNumber({
            phoneNumber: from,
            name: parsed.name,
            location: parsed.location,
            reason: parsed.reason
          }),
          whatsappService.sendTextMessage(from, SPROUT_CONFIRMATION_REPLY)
        ]);
      } else {
        updateConversationState(from, "AWAITING_DETAILS");
        await Promise.allSettled([
          googleSheetService.recordUserNumber({ phoneNumber: from }),
          whatsappService.sendTextMessage(from, SPROUT_WELCOME_REPLY)
        ]);
      }
    }
  } catch (error) {
    console.error("[Webhook Error]:", error.message);
  }
}

module.exports = {
  verifyWebhook,
  handleWebhook,
  parseUserDetails,
  SPROUT_WELCOME_REPLY,
  SPROUT_CONFIRMATION_REPLY
};
