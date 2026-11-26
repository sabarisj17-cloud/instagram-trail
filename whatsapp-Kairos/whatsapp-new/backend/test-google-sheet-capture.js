const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const axios = require("axios");
const googleSheetService = require("./services/googleSheetService");
const whatsappController = require("./controllers/whatsappController");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 TESTING WHATSAPP -> GOOGLE SHEETS & REPLY");
  console.log("==================================================\n");

  const originalPost = axios.post;
  const postedCalls = [];

  try {
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      if (url.includes("graph.facebook.com")) {
        return { status: 200, data: { messages: [{ id: "wamid.mock_out" }] } };
      }
      return { status: 200, data: { status: "success", action: "created" } };
    };

    // Test 1: Invalid phone rejected
    const badRes = await googleSheetService.recordUserNumber("123");
    assert.strictEqual(badRes.success, false, "Should reject short phone numbers");
    assert.strictEqual(postedCalls.length, 0, "Should not call Apps Script for invalid phone");
    console.log("✅ Test 1 passed: Invalid phone numbers rejected.");

    // Test 2: Valid phone sends ONLY phoneNumber
    const okRes = await googleSheetService.recordUserNumber("+91 98765 43210");
    assert.strictEqual(okRes.success, true, "Valid phone number should succeed");
    assert.strictEqual(postedCalls.length, 1);
    assert.deepStrictEqual(postedCalls[0].data, { phoneNumber: "919876543210" });
    console.log("✅ Test 2 passed: recordUserNumber sends clean { phoneNumber } payload.");

    // Test 3: Webhook stores number AND sends exact Sprout welcome reply
    postedCalls.length = 0;
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
                    metadata: {
                      display_phone_number: "917010472311",
                      phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || "1373840235818636"
                    },
                    messages: [
                      {
                        from: "919876501234",
                        id: uniqueId1,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Hello" }
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

    const sheetCall = postedCalls.find((c) => c.url.includes("script.google.com"));
    const waCall = postedCalls.find((c) => c.url.includes("graph.facebook.com"));
    assert(sheetCall, "Should save user phone number to Google Sheet");
    assert.deepStrictEqual(sheetCall.data, { phoneNumber: "919876501234" });
    assert(waCall, "Should send WhatsApp welcome reply");
    assert.strictEqual(waCall.data.to, "919876501234");
    assert.strictEqual(waCall.data.text.body, whatsappController.SPROUT_WELCOME_REPLY);
    console.log("✅ Test 3 passed: Webhook stores phone number AND sends exact Sprout reply.");

    // Test 4: Duplicate messageId ignored
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
                        text: { body: "Hello" }
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
    assert.strictEqual(postedCalls.length, 2, "Duplicate messageId should not trigger extra calls");
    console.log("✅ Test 4 passed: Duplicate messageId dropped.");

    // Test 5: Self-message and different business number are ignored
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
    assert.strictEqual(postedCalls.length, 2, "Self messages and other business numbers should be ignored");
    console.log("✅ Test 5 passed: Self-messages and non-7010472311 business numbers ignored.");

    console.log("\n==================================================");
    console.log("🎉 ALL TESTS PASSED!");
    console.log("==================================================");
  } finally {
    axios.post = originalPost;
  }
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
