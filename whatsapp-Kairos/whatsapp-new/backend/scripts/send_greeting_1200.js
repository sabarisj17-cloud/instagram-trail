const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const whatsappService = require("../services/whatsappService");
const googleSheetService = require("../services/googleSheetService");

function capitalize(str) {
  if (!str) return "";
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

// ONLY this single recipient as explicitly requested
const recipients = [
  { phone: "9500406150", fullPhone: "919500406150", defaultName: "Sabari" }
];

const logFile = path.join(__dirname, "..", "data", "greeting_1200.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + "\n");
}

async function sendGreetings() {
  log("==================================================");
  log("🚀 Executing 12:00 PM Scheduled Greeting Dispatch (Single Recipient Only: 9500406150)");
  log("==================================================");

  for (const item of recipients) {
    try {
      let userName = item.defaultName;
      try {
        const sheetRes = await googleSheetService.getStudentByPhone(item.phone);
        if (sheetRes.success && sheetRes.student?.name) {
          userName = capitalize(sheetRes.student.name);
        }
      } catch (err) {
        log(`Warning: Failed to fetch live sheet name for ${item.phone}, using fallback '${userName}': ${err.message}`);
      }

      const greetingMessage = `Good Day ${userName}, Today is a great day to start studying your next module!! Start now!! Transform your life.`;

      log(`Sending greeting to ${userName} (+${item.fullPhone}): "${greetingMessage}"`);

      const result = await whatsappService.sendTextMessage(item.fullPhone, greetingMessage);

      if (result && result.messages && result.messages[0]) {
        log(`✅ SUCCESS: Message delivered to +${item.fullPhone}. Meta Message ID: ${result.messages[0].id}`);
      } else {
        log(`⚠️ Result for +${item.fullPhone}: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      log(`❌ ERROR sending to +${item.fullPhone}: ${err.message}`);
    }
  }

  log("==================================================");
  log("🏁 12:00 PM greeting dispatched.");
  log("==================================================");
}

// Compute wait time until 12:00:00 PM today
function startScheduler() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(12, 0, 0, 0);

  const delayMs = target.getTime() - now.getTime();

  if (delayMs <= 0) {
    log(`Target 12:00:00 PM already reached (delayMs: ${delayMs}). Sending immediately...`);
    sendGreetings();
    return;
  }

  const delaySec = Math.round(delayMs / 1000);
  log(`Scheduler armed. Current time: ${now.toLocaleTimeString()} | Target: 12:00:00 PM | Waiting ${delaySec}s (${(delaySec / 60).toFixed(1)} mins)...`);

  setTimeout(async () => {
    log(`⏰ Timer triggered at ${new Date().toLocaleTimeString()}! Dispatching message...`);
    await sendGreetings();
    process.exit(0);
  }, delayMs);
}

startScheduler();

