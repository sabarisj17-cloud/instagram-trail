const assert = require("assert");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const axios = require("axios");
const googleSheetService = require("./services/googleSheetService");
const whatsappController = require("./controllers/whatsappController");
const { clearAllSessions } = require("./utils/conversationState");

async function runTests() {
  console.log("==================================================");
  console.log("🧪 TESTING WHATSAPP -> GOOGLE SHEETS & 2-STEP REPLY");
  console.log("==================================================\n");

  const originalPost = axios.post;
  const postedCalls = [];
  clearAllSessions();

  try {
    axios.post = async (url, data, config) => {
      postedCalls.push({ url, data, config });
      if (url.includes("graph.facebook.com")) {
        return { status: 200, data: { messages: [{ id: "wamid.mock_out" }] } };
      }
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

    // Test 1: Invalid phone rejected
    const badRes = await googleSheetService.recordUserNumber("123");
    assert.strictEqual(badRes.success, false, "Should reject short phone numbers");
    assert.strictEqual(postedCalls.length, 0);
    console.log("✅ Test 1 passed: Invalid phone numbers rejected.");

    // Test 2: Step 1 greeting -> stores phone number & sends welcome prompt asking for Name, Location, Reason
    const testPhone = "919876501234";
    const id1 = "wamid.step1_" + Date.now();
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
                        from: testPhone,
                        id: id1,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Hi" }
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

    const step1Sheet = postedCalls.find((c) => c.url.includes("script.google.com"));
    const step1Wa = postedCalls.find((c) => c.url.includes("graph.facebook.com"));
    assert.deepStrictEqual(step1Sheet.data, { phoneNumber: testPhone });
    assert.strictEqual(step1Wa.data.text.body, whatsappController.SPROUT_WELCOME_REPLY);
    console.log("✅ Test 2 passed: Greeting stores number & sends Sprout info prompt.");

    // Test 3: Step 2 user sends 3-line details (sabari / cbe / banking) -> saves details & sends confirmation
    postedCalls.length = 0;
    const id2 = "wamid.step2_" + Date.now();
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
                        from: testPhone,
                        id: id2,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "sabari\ncbe\nbanking" }
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

    const step2Sheet = postedCalls.find((c) => c.url.includes("script.google.com"));
    const step2Wa = postedCalls.find((c) => c.url.includes("graph.facebook.com"));
    assert.deepStrictEqual(step2Sheet.data, {
      phoneNumber: testPhone,
      name: "sabari",
      location: "cbe",
      reason: "banking"
    });
    assert.strictEqual(step2Wa.data.text.body, whatsappController.SPROUT_CONFIRMATION_REPLY);
    console.log("✅ Test 3 passed: 3-line details saved to sheet & confirmation message sent.");

    // Test 4: Labeled details even without prior session (simulating server restart)
    postedCalls.length = 0;
    clearAllSessions();
    const id3 = "wamid.labeled_" + Date.now();
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
                        id: id3,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "Name: Arjun\nLocation: Chennai\nReason for contacting: Loan enquiry" }
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

    const step3Sheet = postedCalls.find((c) => c.url.includes("script.google.com"));
    const step3Wa = postedCalls.find((c) => c.url.includes("graph.facebook.com"));
    assert.deepStrictEqual(step3Sheet.data, {
      phoneNumber: "919123456789",
      name: "Arjun",
      location: "Chennai",
      reason: "Loan enquiry"
    });
    assert.strictEqual(step3Wa.data.text.body, whatsappController.SPROUT_CONFIRMATION_REPLY);
    console.log("✅ Test 4 passed: Labeled details parsed cleanly even after restart.");

    // Test 5: Duplicate, self-message, and non-target business number ignored
    postedCalls.length = 0;
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
                        id: id3,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                        type: "text",
                        text: { body: "duplicate" }
                      },
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
    assert.strictEqual(postedCalls.length, 0);
    console.log("✅ Test 5 passed: Duplicate & self-messages ignored.");

    console.log("\n==================================================");
    console.log("🎉 ALL TESTS PASSED!");
    console.log("==================================================");
  } finally {
    axios.post = originalPost;
    clearAllSessions();
  }
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
