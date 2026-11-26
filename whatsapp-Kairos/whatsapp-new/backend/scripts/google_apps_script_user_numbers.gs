/**
 * Sprout Knowledge Solutions (SproutKS)
 * Google Apps Script Web App — Store Incoming WhatsApp User Number, Date, Time, 1st Message, Details & Selected Option
 *
 * Behavior:
 * - Same user messaging on the SAME date: updates that day's row (keeps Step 1, Step 2, Step 3 on one row for that date).
 * - Same user messaging on a DIFFERENT date (after some days): keeps previous date's row untouched and creates a new row for the new date.
 *
 * Setup:
 * 1. Open your Google Sheet -> Extensions > Apps Script.
 * 2. Replace the script code with this file and Save.
 * 3. Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy
 *    (Execute as: Me, Who has access: Anyone) so your /exec URL stays the same.
 */

const SHEET_NAME = "WhatsApp Users";
const TIMEZONE = "Asia/Kolkata";

/**
 * Health check endpoint (GET)
 */
function doGet() {
  return createJsonResponse({
    status: "ACTIVE",
    service: "SproutKS WhatsApp User Number Google Sheets Webhook",
    timestamp: new Date().toISOString()
  });
}

/**
 * Store incoming WhatsApp user's phone number, date, time, 1st message, details, and Courses/Job selection (POST)
 */
function doPost(e) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000);

    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      data = e.parameter;
    } else {
      return createJsonResponse({
        status: "error",
        message: "Empty request body"
      });
    }

    const rawPhone = String(data.phoneNumber || data.phone || "").trim();
    const digits = rawPhone.replace(/[^0-9]/g, "");

    if (!digits || digits.length < 7) {
      return createJsonResponse({
        status: "error",
        message: "Missing or invalid phoneNumber"
      });
    }

    const formattedPhone = "+" + digits;
    const name = String(data.name || "").trim();
    const location = String(data.location || "").trim();
    const reason = String(data.reason || data.details || "").trim();
    const selectedOption = String(data.selectedOption || data.interest || data.option || "").trim();
    const firstMessage = String(data.firstMessage || data.message || "").trim();

    const now = new Date();
    const dateStr = Utilities.formatDate(now, TIMEZONE, "dd-MM-yyyy");
    const timeStr = Utilities.formatDate(now, TIMEZONE, "hh:mm:ss a");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets()[0] || ss.insertSheet(SHEET_NAME);

    ensureSheetHeaders(sheet);

    const lastRow = sheet.getLastRow();

    // Match by BOTH phone number AND today's date (scan from bottom up).
    // If the user messages again on a later date, it won't match and a new row will be created for that date.
    if (lastRow > 1) {
      const rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (let i = rows.length - 1; i >= 0; i--) {
        const existingDigits = String(rows[i][0] || "").replace(/[^0-9]/g, "");
        const rawDateCell = rows[i][1];
        const existingDate =
          rawDateCell instanceof Date
            ? Utilities.formatDate(rawDateCell, TIMEZONE, "dd-MM-yyyy")
            : String(rawDateCell || "").trim();

        if (existingDigits === digits && existingDate === dateStr) {
          const existingRow = i + 2;
          sheet.getRange(existingRow, 3).setNumberFormat("@").setValue(timeStr);
          if (name) sheet.getRange(existingRow, 4).setNumberFormat("@").setValue(name);
          if (location) sheet.getRange(existingRow, 5).setNumberFormat("@").setValue(location);
          if (reason) sheet.getRange(existingRow, 6).setNumberFormat("@").setValue(reason);
          if (selectedOption) sheet.getRange(existingRow, 7).setNumberFormat("@").setValue(selectedOption);
          if (firstMessage) sheet.getRange(existingRow, 8).setNumberFormat("@").setValue(firstMessage);

          return createJsonResponse({
            status: "success",
            action: "updated_same_date",
            phoneNumber: formattedPhone,
            date: dateStr,
            time: timeStr,
            row: existingRow
          });
        }
      }
    }

    // New user OR same user messaging on a new date: append a new row for this date
    const targetRow = lastRow + 1;
    sheet.getRange(targetRow, 1).setNumberFormat("@").setValue(formattedPhone);
    sheet.getRange(targetRow, 2).setNumberFormat("@").setValue(dateStr);
    sheet.getRange(targetRow, 3).setNumberFormat("@").setValue(timeStr);
    if (name) sheet.getRange(targetRow, 4).setNumberFormat("@").setValue(name);
    if (location) sheet.getRange(targetRow, 5).setNumberFormat("@").setValue(location);
    if (reason) sheet.getRange(targetRow, 6).setNumberFormat("@").setValue(reason);
    if (selectedOption) sheet.getRange(targetRow, 7).setNumberFormat("@").setValue(selectedOption);
    if (firstMessage) sheet.getRange(targetRow, 8).setNumberFormat("@").setValue(firstMessage);

    return createJsonResponse({
      status: "success",
      action: "created",
      phoneNumber: formattedPhone,
      date: dateStr,
      time: timeStr,
      row: targetRow
    });
  } catch (error) {
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

/**
 * Ensure headers exist for Phone Number, Date, Time, Name, Location, Reason, Selected Option, and First Message
 */
function ensureSheetHeaders(sheet) {
  const headers = [
    "WhatsApp Phone Number",
    "Date",
    "Time",
    "Name",
    "Location",
    "Reason for Contacting",
    "Selected Option",
    "First Message"
  ];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const current = headerRange.getValues()[0];

  let needsUpdate = false;
  for (let i = 0; i < headers.length; i++) {
    if (current[i] !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }

  if (needsUpdate) {
    headerRange.setValues([headers]);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#005C53");
    headerRange.setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 200);
    sheet.setColumnWidth(2, 120);
    sheet.setColumnWidth(3, 120);
    sheet.setColumnWidth(4, 180);
    sheet.setColumnWidth(5, 180);
    sheet.setColumnWidth(6, 260);
    sheet.setColumnWidth(7, 160);
    sheet.setColumnWidth(8, 260);
  }
}

/**
 * Build JSON response
 */
function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
