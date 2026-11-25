const axios = require("axios");

const SCRIPT_URL = process.env.GOOGLE_SHEET_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzTStla0QbrBXi557uYRKTpJcimmhToTmTM4kvsXIAOa_WYGKUqMecK9nbaIlpTiFC-/exec";
const DEFAULT_ENQUIRY_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzfPYDloxoTYSV5U9wz6OPp9sLbiUEEI6VBNAYJmj0hmMvz1hTNCdgo9VfQCTHYsMfvOQ/exec";

function getEnquiryScriptUrl() {
  return process.env.COURSE_ENQUIRY_SHEET_SCRIPT_URL || DEFAULT_ENQUIRY_SCRIPT_URL;
}

// In-memory cache to ensure sub-second response times for repeat interactions
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Normalizes phone number to last 10 digits for accurate matching
 * e.g. "919500406150" -> "9500406150", "+91 9500406150" -> "9500406150"
 */
function normalizePhone(rawPhone) {
  if (!rawPhone) return "";
  const cleaned = String(rawPhone).replace(/\D/g, "");
  if (cleaned.length > 10) {
    return cleaned.slice(-10);
  }
  return cleaned;
}

/**
 * Fetches student record from Google Sheets via Apps Script Web App.
 * Always queries live data so updates in Google Sheets (e.g. changing 'no' to 'yes')
 * take effect instantly in real-time.
 * 
 * @param {string} phone Student's phone number
 * @param {boolean} forceLive Always bypass cache
 * @returns {Promise<{success: boolean, student?: object, message?: string}>}
 */
async function getStudentByPhone(phone, forceLive = true) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    return { success: false, message: "Invalid phone number" };
  }

  // Short 2-second debounce cache to handle duplicate webhook bursts without delaying live edits
  const cached = cache.get(normalized);
  if (!forceLive && cached && (Date.now() - cached.timestamp < 2000)) {
    return { success: true, student: cached.data };
  }

  try {
    const response = await axios.post(
      SCRIPT_URL,
      { phone: normalized, action: "getStudent" },
      {
        timeout: 25000,
        maxRedirects: 5,
        headers: { "Content-Type": "application/json" }
      }
    );

    if (response.data && response.data.success && response.data.student) {
      const student = response.data.student;
      // Ensure progressSeconds is a number
      student.progressSeconds = Number(student.progressSeconds) || 0;
      // Clean and normalize paymentStatus (trim whitespace)
      student.paymentStatus = String(student.paymentStatus || "").trim().toLowerCase();
      cache.set(normalized, { data: student, timestamp: Date.now() });
      return { success: true, student };
    }

    return {
      success: false,
      message: response.data?.message || "Student not found"
    };
  } catch (error) {
    console.error(`[GoogleSheetService] Error fetching student (${normalized}):`, error.message);
    // If cached version exists, return as graceful offline fallback
    if (cached) {
      return { success: true, student: cached.data };
    }
    return { success: false, message: "Failed to connect to student records" };
  }
}

/**
 * Updates student's video watch progress in Google Sheets
 * 
 * @param {string} phone Student's phone number
 * @param {number} progressSeconds Watched timestamp in seconds
 * @returns {Promise<{success: boolean, updatedProgress?: number}>}
 */
async function updateStudentProgress(phone, progressSeconds) {
  const normalized = normalizePhone(phone);
  const seconds = Math.max(0, Math.floor(Number(progressSeconds) || 0));

  // Update in-memory cache immediately
  const cached = cache.get(normalized);
  if (cached) {
    cached.data.progressSeconds = seconds;
    cached.timestamp = Date.now();
  }

  try {
    const response = await axios.post(
      SCRIPT_URL,
      {
        phone: normalized,
        action: "updateProgress",
        progressSeconds: seconds
      },
      {
        timeout: 10000,
        maxRedirects: 5,
        headers: { "Content-Type": "application/json" }
      }
    );

    console.log(`[GoogleSheetService] Progress synced for ${normalized}: ${seconds}s ->`, response.data);
    return response.data;
  } catch (error) {
    console.error(`[GoogleSheetService] Error updating progress for ${normalized}:`, error.message);
    return { success: false, message: error.message };
  }
}

/**
 * Records an incoming WhatsApp user's phone number into the Course Enquiry Google Sheet
 * via the configured Apps Script Web App.
 *
 * @param {object} params
 * @param {string} params.phoneNumber Sender's WhatsApp phone number (digits with country code)
 * @param {string} [params.selectedCourse] Course name (defaults to "Business Success Class")
 * @param {string} [params.name] WhatsApp profile name if available
 * @param {string} [params.message] Incoming message text/summary
 * @param {string} [params.messageType] WhatsApp message type (text, image, interactive, etc.)
 * @param {string} [params.messageId] Meta WhatsApp message ID
 * @param {string} [params.receiverNumber] Bot WhatsApp number that received the message
 * @returns {Promise<{success: boolean, data?: object, message?: string}>}
 */
async function recordUserEnquiry({
  phoneNumber,
  selectedCourse,
  name,
  message,
  messageType = "text",
  messageId,
  receiverNumber
} = {}) {
  const cleanPhone = String(phoneNumber || "").replace(/\D/g, "");
  if (!cleanPhone || cleanPhone.length < 7) {
    return { success: false, message: "Invalid phone number" };
  }

  const course = String(
    selectedCourse || process.env.DEFAULT_COURSE_NAME || "Business Success Class"
  ).trim();
  const url = getEnquiryScriptUrl();

  const payload = {
    phoneNumber: cleanPhone,
    selectedCourse: course,
    messageType,
    timestamp: new Date().toISOString()
  };
  if (name) payload.name = String(name).trim().slice(0, 120);
  if (message) payload.message = String(message).trim().slice(0, 500);
  if (messageId) payload.messageId = String(messageId);
  if (receiverNumber) payload.receiverNumber = String(receiverNumber).replace(/\D/g, "");

  const maxAttempts = 2;
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
        console.error(`[GoogleSheetService] Enquiry script rejected (${cleanPhone}): ${errMsg}`);
        return { success: false, message: errMsg, data };
      }

      console.log(`[GoogleSheetService] User number stored in Google Sheet (${cleanPhone}):`, data);
      return { success: true, data };
    } catch (error) {
      const status = error.response?.status;
      const retryable = !status || status >= 500 || status === 429;
      if (attempt < maxAttempts && retryable) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      console.error(`[GoogleSheetService] Error storing user number (${cleanPhone}):`, error.message);
      return { success: false, message: error.message };
    }
  }
}

/**
 * Invalidate cache for a phone number
 */
function invalidateCache(phone) {
  const normalized = normalizePhone(phone);
  cache.delete(normalized);
}

module.exports = {
  normalizePhone,
  getStudentByPhone,
  updateStudentProgress,
  recordUserEnquiry,
  invalidateCache
};
