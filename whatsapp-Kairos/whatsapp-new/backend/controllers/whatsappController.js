const googleSheetService = require("../services/googleSheetService");
const whatsappService = require("../services/whatsappService");
const { isDuplicateMessage } = require("../utils/conversationState");

const SPROUT_WELCOME_REPLY = [
  "Hello 👋 Thank you for contacting Sprout.",
  "Kindly provide the following information:",
  "Name:",
  "Location:",
  "Reason for contacting:",
  "",
  "Our representative will contact you shortly with complete details."
].join("\n");

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
 * Stores sender's WhatsApp phone number in Google Sheets and sends the Sprout welcome reply.
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

      await Promise.allSettled([
        googleSheetService.recordUserNumber(from),
        whatsappService.sendTextMessage(from, SPROUT_WELCOME_REPLY)
      ]);
    }
  } catch (error) {
    console.error("[Webhook Error]:", error.message);
  }
}

module.exports = {
  verifyWebhook,
  handleWebhook,
  SPROUT_WELCOME_REPLY
};
