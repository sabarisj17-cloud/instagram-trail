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

const recipients = [
  { phone: "9500070756", fullPhone: "919500070756", defaultName: "Senthikumar" },
  { phone: "9866011294", fullPhone: "919866011294", defaultName: "Shailendra" },
  { phone: "9500406150", fullPhone: "919500406150", defaultName: "Sabari" }
];

const logFile = path.join(__dirname, "..", "data", "greeting_1130.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(logFile, line + "\n");
}

async function sendGreetings() {
  log("==================================================");
  log("🚀 Executing 11:30 AM Scheduled Greetings Dispatch");
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
  log("🏁 All 11:30 AM greetings dispatched.");
  log("==================================================");
}

// Compute wait time until 11:30:00 AM today
function startScheduler() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(11, 30, 0, 0);

  const delayMs = target.getTime() - now.getTime();

  if (delayMs <= 0) {
    log(`Target 11:30:00 AM already reached (delayMs: ${delayMs}). Sending immediately...`);
    sendGreetings();
    return;
  }

  const delaySec = Math.round(delayMs / 1000);
  log(`Scheduler armed. Current time: ${now.toLocaleTimeString()} | Target: 11:30:00 AM | Waiting ${delaySec}s (${(delaySec / 60).toFixed(1)} mins)...`);

  setTimeout(async () => {
    log(`⏰ Timer triggered at ${new Date().toLocaleTimeString()}! Dispatching messages...`);
    await sendGreetings();
    process.exit(0);
  }, delayMs);
}

startScheduler();

