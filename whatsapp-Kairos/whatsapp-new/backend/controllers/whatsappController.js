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

const SPROUT_CHOICE_PROMPT = "Please select what you are looking for:";
const SPROUT_CHOICE_BUTTONS = [
  { id: "CHOICE_COURSES", title: "Courses" },
  { id: "CHOICE_JOB", title: "Job" }
];

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
 * Extract readable text and optional button ID from an incoming WhatsApp message
 */
function extractMessagePayload(message) {
  switch (message.type) {
    case "text":
      return { text: message.text?.body || "", buttonId: null };
    case "image":
      return { text: message.image?.caption || "", buttonId: null };
    case "video":
      return { text: message.video?.caption || "", buttonId: null };
    case "button":
      return {
        text: message.button?.text || "",
        buttonId: message.button?.payload || message.button?.text || null
      };
    case "interactive":
      if (message.interactive?.type === "button_reply") {
        return {
          text: message.interactive.button_reply?.title || "",
          buttonId: message.interactive.button_reply?.id || null
        };
      }
      if (message.interactive?.type === "list_reply") {
        return {
          text: message.interactive.list_reply?.title || "",
          buttonId: message.interactive.list_reply?.id || null
        };
      }
      return { text: "", buttonId: null };
    default:
      return { text: "", buttonId: null };
  }
}

/**
 * Detect Courses or Job selection from button ID or text
 */
function detectSelectedOption(rawText, buttonId) {
  if (buttonId === "CHOICE_COURSES") return "Courses";
  if (buttonId === "CHOICE_JOB") return "Job";

  const clean = String(rawText || "").trim().toLowerCase();
  if (clean === "courses" || clean === "course") return "Courses";
  if (clean === "job" || clean === "jobs") return "Job";
  return null;
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

  if (lines.length >= 2) {
    name = lines[0];
    location = lines[1];
    reason = lines.slice(2).join(" | ");
    return { name, location, reason, isStructured: true };
  }

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
 * 2. Details reply: saves Name, Location, Reason and sends [Courses] / [Job] buttons.
 * 3. Option click (Courses / Job): saves selectedOption to Sheets and sends final confirmation.
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

      const { text: rawText, buttonId } = extractMessagePayload(message);
      const normalizedText = rawText.trim().toLowerCase();
      const selectedOption = detectSelectedOption(rawText, buttonId);
      const isGreeting = !rawText.trim() && !buttonId ? true : GREETING_WORDS.has(normalizedText);
      const state = getConversationState(from);
      const parsed = parseUserDetails(rawText);

      // Step 3: User clicked [Courses] or [Job] (or typed "courses" / "job" when prompted)
      if (
        buttonId === "CHOICE_COURSES" ||
        buttonId === "CHOICE_JOB" ||
        (selectedOption && state.step === "AWAITING_CHOICE")
      ) {
        updateConversationState(from, "COMPLETED");
        await Promise.allSettled([
          googleSheetService.recordUserNumber({
            phoneNumber: from,
            selectedOption
          }),
          whatsappService.sendTextMessage(from, SPROUT_CONFIRMATION_REPLY)
        ]);
        continue;
      }

      // Step 2: User provided details -> save details & ask Courses or Job via interactive buttons
      const isDetailsSubmission =
        !isGreeting &&
        parsed &&
        (state.step === "AWAITING_DETAILS" ||
          state.step === "AWAITING_CHOICE" ||
          state.step === "COMPLETED" ||
          parsed.isStructured);

      if (isDetailsSubmission) {
        updateConversationState(from, "AWAITING_CHOICE");
        await Promise.allSettled([
          googleSheetService.recordUserNumber({
            phoneNumber: from,
            name: parsed.name,
            location: parsed.location,
            reason: parsed.reason
          }),
          whatsappService.sendButtonMessage(from, SPROUT_CHOICE_PROMPT, SPROUT_CHOICE_BUTTONS)
        ]);
        continue;
      }

      // Step 1: Initial contact / greeting -> save phone + date + time & send Sprout info prompt
      updateConversationState(from, "AWAITING_DETAILS");
      await Promise.allSettled([
        googleSheetService.recordUserNumber({ phoneNumber: from }),
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
  parseUserDetails,
  detectSelectedOption,
  SPROUT_WELCOME_REPLY,
  SPROUT_CHOICE_PROMPT,
  SPROUT_CHOICE_BUTTONS,
  SPROUT_CONFIRMATION_REPLY
};
