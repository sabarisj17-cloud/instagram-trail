const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const axios = require("axios");
const googleSheetService = require("./services/googleSheetService");
const whatsappController = require("./controllers/whatsappController");
const chatbotService = require("./services/chatbotService");
const whatsappService = require("./services/whatsappService");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 TESTING GOOGLE SHEETS USER NUMBER CAPTURE");
  console.log("==================================================\n");

  const originalPost = axios.post;
  const originalProcessMessage = chatbotService.processMessage;
  const originalSendSeq = whatsappService.sendMessageSequence;
  const originalMarkAsRead = whatsappService.markAsRead;

  const postedCalls = [];

  try {
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      return { status: 200, data: { status: "success", action: "created" } };
    };
    chatbotService.processMessage = async () => [];
    whatsappService.sendMessageSequence = async () => {};
    whatsappService.markAsRead = async () => {};

    // Test 1: Invalid phone rejected
    const badRes = await googleSheetService.recordUserNumber("123");
    assert.strictEqual(badRes.success, false, "Should reject short phone numbers");
    assert.strictEqual(postedCalls.length, 0, "Should not call Apps Script for invalid phone");
    console.log("✅ Test 1 passed: Invalid phone numbers rejected before HTTP call.");

    // Test 2: Valid phone sends ONLY phoneNumber to the script URL
    const okRes = await googleSheetService.recordUserNumber("+91 98765 43210");
    assert.strictEqual(okRes.success, true, "Valid phone number should succeed");
    assert.strictEqual(postedCalls.length, 1);
    assert.deepStrictEqual(postedCalls[0].data, { phoneNumber: "919876543210" });
    assert.strictEqual(postedCalls[0].config.maxRedirects, 5);
    console.log("✅ Test 2 passed: recordUserNumber sends clean { phoneNumber } payload.");

    // Test 3: Retry once on transient network error
    let attemptCount = 0;
    axios.post = async () => {
      attemptCount++;
      if (attemptCount === 1) {
        throw new Error("ETIMEDOUT");
      }
      return { status: 200, data: { status: "success", action: "created" } };
    };
    const retryRes = await googleSheetService.recordUserNumber("919876543211");
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(attemptCount, 2, "Should retry once on transient network error");
    console.log("✅ Test 3 passed: Transient network errors retry once.");

    // Restore mock for webhook tests
    postedCalls.length = 0;
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      return { status: 200, data: { status: "success", action: "created" } };
    };

    const makeRes = () => ({
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      send(b) {
        this.body = b;
        return this;
      }
    });

    // Test 4: Webhook text message to 7010472311 stores sender phone number alone
    const uniqueId1 = "wamid.gs_test_" + Date.now();
    await whatsappController.handleWebhook(
      {
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    messaging_product: "whatsapp",
                    metadata: {
                      display_phone_number: "917010472311",
                      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || "1373840235818636"
                    },
                    contacts: [{ profile: { name: "Arjun" }, wa_id: "919876501234" }],
                    messages: [
                      {
                        from: "919876501234",
                        id: uniqueId1,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Hello Kairos" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      makeRes()
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(postedCalls.length, 1, "Webhook text message should trigger sheet save");
    assert.deepStrictEqual(postedCalls[0].data, { phoneNumber: "919876501234" });
    console.log("✅ Test 4 passed: Webhook text message stores sender phone number alone.");

    // Test 5: Duplicate messageId is ignored
    await whatsappController.handleWebhook(
      {
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { display_phone_number: "917010472311", phone_number_id: "1373840235818636" },
                    messages: [
                      {
                        from: "919876501234",
                        id: uniqueId1,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Hello Kairos" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      makeRes()
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(postedCalls.length, 1, "Duplicate messageId should not trigger duplicate sheet save");
    console.log("✅ Test 5 passed: Duplicate messageId dropped.");

    // Test 6: Audio message without text still stores user number
    const uniqueId2 = "wamid.gs_audio_" + Date.now();
    await whatsappController.handleWebhook(
      {
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { display_phone_number: "917010472311", phone_number_id: "1373840235818636" },
                    messages: [
                      {
                        from: "919123456789",
                        id: uniqueId2,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "audio",
                        audio: { id: "aud_1", voice: true, mime_type: "audio/ogg" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      makeRes()
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(postedCalls.length, 2, "Audio message should still store user number");
    assert.deepStrictEqual(postedCalls[1].data, { phoneNumber: "919123456789" });
    console.log("✅ Test 6 passed: Non-text (audio) message still stores user number.");

    // Test 7: Self-message and different business number are NOT stored
    await whatsappController.handleWebhook(
      {
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { display_phone_number: "917010472311", phone_number_id: "1373840235818636" },
                    messages: [
                      {
                        from: "917010472311",
                        id: "wamid.self_" + Date.now(),
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "bot echo" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      makeRes()
    );
    await whatsappController.handleWebhook(
      {
        body: {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  value: {
                    metadata: { display_phone_number: "919999999999", phone_number_id: "000000000" },
                    messages: [
                      {
                        from: "919111111111",
                        id: "wamid.other_" + Date.now(),
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "wrong number" }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        }
      },
      makeRes()
    );
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(postedCalls.length, 2, "Self messages and other business numbers should be ignored");
    console.log("✅ Test 7 passed: Self-messages and non-7010472311 business numbers ignored.");

    console.log("\n==================================================");
    console.log("🎉 ALL GOOGLE SHEETS CAPTURE TESTS PASSED!");
    console.log("==================================================");
  } finally {
    axios.post = originalPost;
    chatbotService.processMessage = originalProcessMessage;
    whatsappService.sendMessageSequence = originalSendSeq;
    whatsappService.markAsRead = originalMarkAsRead;
  }
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
