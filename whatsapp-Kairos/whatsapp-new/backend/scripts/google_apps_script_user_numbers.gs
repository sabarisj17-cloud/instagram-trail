/**
 * Sprout Knowledge Solutions (SproutKS)
 * Google Apps Script Web App — Store Incoming WhatsApp User Phone Numbers Only
 *
 * Setup:
 * 1. Open your Google Sheet -> Extensions > Apps Script.
 * 2. Replace the script code with this file and Save.
 * 3. Deploy > New deployment (or Manage deployments > Edit > New version to keep the same URL).
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 */

const SHEET_NAME = "WhatsApp Users";

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
 * Store incoming WhatsApp user's phone number alone (POST)
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

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheets()[0] || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      initializeSheetHeaders(sheet);
    }

    const lastRow = sheet.getLastRow();

    // Prevent duplicate rows for the same phone number
    if (lastRow > 1) {
      const phoneValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < phoneValues.length; i++) {
        const existingDigits = String(phoneValues[i][0]).replace(/[^0-9]/g, "");
        if (existingDigits === digits) {
          return createJsonResponse({
            status: "success",
            action: "already_exists",
            phoneNumber: formattedPhone,
            row: i + 2
          });
        }
      }
    }

    const targetRow = lastRow + 1;
    const phoneCell = sheet.getRange(targetRow, 1);
    phoneCell.setNumberFormat("@"); // Store as plain text so '+' is preserved cleanly
    phoneCell.setValue(formattedPhone);

    return createJsonResponse({
      status: "success",
      action: "created",
      phoneNumber: formattedPhone,
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
 * Initialize single-column header and formatting
 */
function initializeSheetHeaders(sheet) {
  const headers = ["WhatsApp Phone Number"];
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#005C53");
  headerRange.setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 220);
}

/**
 * Build JSON response
 */
function createJsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
