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
    // Mock outbound network calls so tests never pollute production Google Sheets or send real WhatsApp messages
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      if (url.includes("AKfycbzfPYDloxoTYSV5U9wz6OPp9sLbiUEEI6VBNAYJmj0hmMvz1hTNCdgo9VfQCTHYsMfvOQ")) {
        return { status: 200, data: { status: "success", message: "Row added" } };
      }
      return { status: 200, data: { success: true } };
    };
    chatbotService.processMessage = async () => [];
    whatsappService.sendMessageSequence = async () => {};
    whatsappService.markAsRead = async () => {};

    // Test 1: Invalid phone rejected
    const badRes = await googleSheetService.recordUserEnquiry({ phoneNumber: "123" });
    assert.strictEqual(badRes.success, false, "Should reject short phone numbers");
    assert.strictEqual(postedCalls.length, 0, "Should not call Apps Script for invalid phone");
    console.log("✅ Test 1 passed: Invalid phone numbers rejected before HTTP call.");

    // Test 2: Valid enquiry sends required phoneNumber & selectedCourse to the new script URL
    const okRes = await googleSheetService.recordUserEnquiry({
      phoneNumber: "+91 98765 43210",
      name: "Test User",
      message: "Hi",
      messageType: "text",
      messageId: "wamid.unit_1",
      receiverNumber: "917010472311"
    });
    assert.strictEqual(okRes.success, true, "Valid enquiry should succeed");
    assert.strictEqual(postedCalls.length, 1);
    assert.strictEqual(
      postedCalls[0].url,
      "https://script.google.com/macros/s/AKfycbzfPYDloxoTYSV5U9wz6OPp9sLbiUEEI6VBNAYJmj0hmMvz1hTNCdgo9VfQCTHYsMfvOQ/exec"
    );
    assert.strictEqual(postedCalls[0].data.phoneNumber, "919876543210");
    assert.strictEqual(postedCalls[0].data.selectedCourse, "Business Success Class");
    assert.strictEqual(postedCalls[0].data.name, "Test User");
    assert.strictEqual(postedCalls[0].config.maxRedirects, 5);
    console.log("✅ Test 2 passed: recordUserEnquiry sends phoneNumber & selectedCourse to new Apps Script.");

    // Test 3: Retry once on transient network error
    let attemptCount = 0;
    axios.post = async (url, data) => {
      attemptCount++;
      if (attemptCount === 1) {
        const err = new Error("ETIMEDOUT");
        throw err;
      }
      return { status: 200, data: { status: "success" } };
    };
    const retryRes = await googleSheetService.recordUserEnquiry({ phoneNumber: "919876543211" });
    assert.strictEqual(retryRes.success, true);
    assert.strictEqual(attemptCount, 2, "Should retry once on transient network error");
    console.log("✅ Test 3 passed: Transient network errors retry once.");

    // Restore mock for webhook tests
    postedCalls.length = 0;
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      return { status: 200, data: { status: "success" } };
    };

    const makeRes = () => {
      const resObj = {
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
      };
      return resObj;
    };

    // Test 4: Webhook text message to 7010472311 stores sender number + profile name
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
    assert.strictEqual(postedCalls[0].data.phoneNumber, "919876501234");
    assert.strictEqual(postedCalls[0].data.name, "Arjun");
    assert.strictEqual(postedCalls[0].data.message, "Hello Kairos");
    console.log("✅ Test 4 passed: Webhook text message stores sender number and profile name.");

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
    assert.strictEqual(postedCalls[1].data.phoneNumber, "919123456789");
    assert.strictEqual(postedCalls[1].data.messageType, "audio");
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
