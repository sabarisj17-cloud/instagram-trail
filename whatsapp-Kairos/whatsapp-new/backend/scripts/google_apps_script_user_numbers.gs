/**
 * Sprout Knowledge Solutions (SproutKS)
 * Google Apps Script Web App — Store Incoming WhatsApp User Number, Date, Time & Details
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
 * Store incoming WhatsApp user's phone number, date, time, and details (POST)
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

    const now = new Date();
    const dateStr = Utilities.formatDate(now, TIMEZONE, "dd-MM-yyyy");
    const timeStr = Utilities.formatDate(now, TIMEZONE, "hh:mm:ss a");

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheets()[0] || ss.insertSheet(SHEET_NAME);

    ensureSheetHeaders(sheet);

    const lastRow = sheet.getLastRow();

    // If number already exists, update Date, Time, and any newly provided details
    if (lastRow > 1) {
      const phoneValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < phoneValues.length; i++) {
        const existingDigits = String(phoneValues[i][0]).replace(/[^0-9]/g, "");
        if (existingDigits === digits) {
          const existingRow = i + 2;
          sheet.getRange(existingRow, 2).setNumberFormat("@").setValue(dateStr);
          sheet.getRange(existingRow, 3).setNumberFormat("@").setValue(timeStr);
          if (name) sheet.getRange(existingRow, 4).setNumberFormat("@").setValue(name);
          if (location) sheet.getRange(existingRow, 5).setNumberFormat("@").setValue(location);
          if (reason) sheet.getRange(existingRow, 6).setNumberFormat("@").setValue(reason);

          return createJsonResponse({
            status: "success",
            action: name || location || reason ? "updated_details" : "updated_timestamp",
            phoneNumber: formattedPhone,
            date: dateStr,
            time: timeStr,
            row: existingRow
          });
        }
      }
    }

    // New user: append Phone Number, Date, Time, and any provided details
    const targetRow = lastRow + 1;
    sheet.getRange(targetRow, 1).setNumberFormat("@").setValue(formattedPhone);
    sheet.getRange(targetRow, 2).setNumberFormat("@").setValue(dateStr);
    sheet.getRange(targetRow, 3).setNumberFormat("@").setValue(timeStr);
    if (name) sheet.getRange(targetRow, 4).setNumberFormat("@").setValue(name);
    if (location) sheet.getRange(targetRow, 5).setNumberFormat("@").setValue(location);
    if (reason) sheet.getRange(targetRow, 6).setNumberFormat("@").setValue(reason);

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
 * Ensure headers exist for Phone Number, Date, Time, Name, Location, and Reason
 */
function ensureSheetHeaders(sheet) {
  const headers = [
    "WhatsApp Phone Number",
    "Date",
    "Time",
    "Name",
    "Location",
    "Reason for Contacting"
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
