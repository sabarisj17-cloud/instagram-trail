const axios = require("axios");

const DEFAULT_USER_NUMBER_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbyOupbGtSY0ETFhnXgdjYf8ix2LRbTZL4ZzefpJoCMf_Gobb0oY2TVOVQHTyOhgvZDD/exec";

function getUserNumberScriptUrl() {
  return process.env.USER_NUMBER_SHEET_SCRIPT_URL || DEFAULT_USER_NUMBER_SCRIPT_URL;
}

/**
 * Records an incoming WhatsApp user's phone number and optional details
 * into Google Sheets via the configured Apps Script Web App.
 *
 * @param {string|object} phoneOrOptions Phone number string or { phoneNumber, name, location, reason, selectedOption }
 * @returns {Promise<{success: boolean, data?: object, message?: string}>}
 */
async function recordUserNumber(phoneOrOptions) {
  const isObj = typeof phoneOrOptions === "object" && phoneOrOptions !== null;
  const rawPhone = isObj ? phoneOrOptions.phoneNumber || phoneOrOptions.phone : phoneOrOptions;

  const cleanPhone = String(rawPhone || "").replace(/\D/g, "");
  if (!cleanPhone || cleanPhone.length < 7) {
    return { success: false, message: "Invalid phone number" };
  }

  const url = getUserNumberScriptUrl();
  const payload = { phoneNumber: cleanPhone };

  if (isObj) {
    if (phoneOrOptions.name) payload.name = String(phoneOrOptions.name).trim().slice(0, 150);
    if (phoneOrOptions.location) payload.location = String(phoneOrOptions.location).trim().slice(0, 150);
    if (phoneOrOptions.reason) payload.reason = String(phoneOrOptions.reason).trim().slice(0, 500);
    if (phoneOrOptions.selectedOption) {
      payload.selectedOption = String(phoneOrOptions.selectedOption).trim().slice(0, 100);
    }
  }

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await axios.post(url, payload, {
        timeout: 25000,
        maxRedirects: 5,
        headers: { "Content-Type": "application/json" }
      });

      const data = response.data;
      if (data && (data.status === "error" || data.success === false)) {
        const errMsg = data.message || "Google Apps Script returned an error";
        console.error(`[GoogleSheetService] User number script rejected (${cleanPhone}): ${errMsg}`);
        return { success: false, message: errMsg, data };
      }

      console.log(`[GoogleSheetService] Saved to Google Sheet (${cleanPhone}):`, data);
      return { success: true, data };
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (attempt < maxAttempts && retryable) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      console.error(`[GoogleSheetService] Error saving to Google Sheet (${cleanPhone}):`, error.message);
      return { success: false, message: error.message };
    }
  }
}

module.exports = {
  recordUserNumber
};
