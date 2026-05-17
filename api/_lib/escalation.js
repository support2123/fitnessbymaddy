const { sendWhatsApp } = require("./whatsapp");

/**
 * Keywords / phrases that trigger escalation to a human.
 * All matching is case-insensitive.
 */
const ESCALATION_KEYWORDS = [
  "injury",
  "medical",
  "pregnant",
  "pregnancy",
  "medication",
  "pain",
  "dizzy",
  "dizziness",
  "eating disorder",
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "not working",
];

/**
 * Check whether a message warrants escalation to a human.
 * @param {string} messageText
 * @returns {{ shouldEscalate: boolean, reason: string }}
 */
function checkEscalation(messageText) {
  const lower = String(messageText).toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return { shouldEscalate: true, reason: keyword };
    }
  }

  return { shouldEscalate: false, reason: "" };
}

/**
 * Notify Maddy via WhatsApp about an escalation.
 * @param {string} reason  - The keyword / reason that triggered escalation
 * @param {object} context - Additional context (lead phone, message excerpt, etc.)
 * @returns {Promise<object>}
 */
async function notifyMaddy(reason, context) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) {
    console.error("[escalation] Missing MADDY_PHONE env var — cannot notify");
    return { skipped: true, reason: "no_maddy_phone" };
  }

  const params = [
    reason,
    context.phone || "unknown",
    context.message || "No message provided",
  ];

  return sendWhatsApp(maddyPhone, "escalation_alert", params);
}

module.exports = { checkEscalation, notifyMaddy };
