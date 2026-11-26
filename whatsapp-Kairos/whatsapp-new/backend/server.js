const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const https = require("https");
const webhookRoutes = require("./routes/webhook");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// WhatsApp Webhook routes
app.use("/webhook", webhookRoutes);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Meta App Publishing Legal Pages
app.get("/privacy-policy", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Privacy Policy - Kairos</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}</style></head>
<body>
  <h1>Privacy Policy - Kairos</h1>
  <p><strong>Effective Date:</strong> November 2026</p>
  <p>Kairos operates an official WhatsApp Cloud API webhook on <strong>+91 70104 72311</strong>.</p>
  <h2>Information We Collect</h2>
  <p>When you message our WhatsApp number, your WhatsApp phone number is recorded in our sheet for follow-up. We do not sell or share your personal data with third parties for marketing.</p>
  <h2>Data Deletion &amp; Contact</h2>
  <p>You may request deletion of your phone number at any time by emailing <a href="mailto:sjsabari57@gmail.com">sjsabari57@gmail.com</a>.</p>
</body>
</html>`);
});

app.get("/terms-of-service", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Terms of Service - Kairos</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}</style></head>
<body>
  <h1>Terms of Service - Kairos</h1>
  <p>By messaging Kairos on WhatsApp (+91 70104 72311), you consent to storing your WhatsApp phone number for contact and follow-up. For assistance, contact <a href="mailto:sjsabari57@gmail.com">sjsabari57@gmail.com</a>.</p>
</body>
</html>`);
});

app.get("/data-deletion", (req, res) => {
  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>User Data Deletion - Kairos</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6;color:#222}</style></head>
<body>
  <h1>User Data Deletion Instructions - Kairos</h1>
  <p>To request deletion of your WhatsApp phone number, email <a href="mailto:sjsabari57@gmail.com">sjsabari57@gmail.com</a> with the subject <strong>"Delete My WhatsApp Data"</strong> and include your phone number.</p>
</body>
</html>`);
});

// Server status endpoint
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "WhatsApp Number Capture to Google Sheets",
    phoneRegistered: process.env.WHATSAPP_PHONE_NUMBER || "+917010472311",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "1373840235818636",
    webhookConfigured: "/webhook",
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found. Use /webhook for Meta Webhooks." });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("[Internal Server Error]:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("🚀 WhatsApp -> Google Sheets Webhook is LIVE");
  console.log(`📡 Server running on: http://localhost:${PORT}`);
  console.log(`🔗 Webhook GET/POST: http://localhost:${PORT}/webhook`);
  console.log(`🩺 Health check: http://localhost:${PORT}/health`);
  console.log("==================================================");

  // Keep-awake ping every 10 minutes
  const keepAliveBaseUrl = (process.env.SERVER_BASE_URL || "https://instagram-trail.onrender.com").replace(/\/$/, "");
  const keepAliveUrl = `${keepAliveBaseUrl}/health`;
  setInterval(() => {
    https.get(keepAliveUrl, (res) => {
      console.log(`[Keep-Alive Ping] Status: ${res.statusCode}`);
    }).on("error", (err) => {
      console.warn(`[Keep-Alive Ping] Notice: ${err.message}`);
    });
  }, 10 * 60 * 1000);
});
