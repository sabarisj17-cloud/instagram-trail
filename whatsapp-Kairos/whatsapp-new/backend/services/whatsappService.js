const axios = require("axios");

const DEFAULT_ACCESS_TOKEN =
  "EAAPsDL5wjWIBSyLWUOd30q8oLPPVwoUivhnwMSuzjRa1F4DQPgNPMD0ITjNKd2ls2LSEPUKPmjzqbpHfyP5uYD4e3JlDQ4xdfNNIQOy27IhYWi1AEekYWCywMm5xwvunGTFd1lRLAxcHUPZCLOlCyJViyaJ81s0yfxvoctwAJ2T9vwUZBUNRC0RuzT0gWZA7QZDZD";

/**
 * Send a WhatsApp Cloud API message payload.
 *
 * @param {object} payload Meta Graph API message payload
 * @returns {Promise<object|null>}
 */
async function executeSend(payload) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN || DEFAULT_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || "1373840235818636";
  const apiVersion = process.env.GRAPH_API_VERSION || "v26.0";
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  try {
    const response = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    });
    const msgId = response.data?.messages?.[0]?.id || "OK";
    console.log(`[WhatsApp Outbound] Sent message to ${payload.to} (ID: ${msgId})`);
    return response.data;
  } catch (error) {
    const status = error.response ? error.response.status : "NETWORK_ERROR";
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`[WhatsApp API Error] Status: ${status} | Details: ${errMsg}`);
    return null;
  }
}

/**
 * Send a plain text WhatsApp message via Meta Cloud API.
 *
 * @param {string} to Recipient WhatsApp phone number
 * @param {string} body Message body text
 * @returns {Promise<object|null>}
 */
async function sendTextMessage(to, body) {
  const cleanTo = String(to || "").replace(/\D/g, "");
  if (!cleanTo || !body) {
    return null;
  }

  return executeSend({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanTo,
    type: "text",
    text: {
      body: String(body)
    }
  });
}

/**
 * Send an interactive quick-reply button message via Meta Cloud API.
 *
 * @param {string} to Recipient WhatsApp phone number
 * @param {string} bodyText Prompt body text
 * @param {Array<{id: string, title: string}>} buttons Up to 3 buttons (title max 20 chars)
 * @returns {Promise<object|null>}
 */
async function sendButtonMessage(to, bodyText, buttons = []) {
  const cleanTo = String(to || "").replace(/\D/g, "");
  if (!cleanTo || !bodyText || !buttons.length) {
    return null;
  }

  return executeSend({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: cleanTo,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: String(bodyText)
      },
      action: {
        buttons: buttons.slice(0, 3).map((btn) => ({
          type: "reply",
          reply: {
            id: String(btn.id).slice(0, 256),
            title: String(btn.title).slice(0, 20)
          }
        }))
      }
    }
  });
}

module.exports = {
  sendTextMessage,
  sendButtonMessage
};
