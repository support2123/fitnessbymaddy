const { sendText } = require("./whatsapp");
const { maskPhone } = require("./whatsapp");

const MADDY_PHONE = "+917082478374";

const ESCALATION_KEYWORDS = [
  "injury",
  "medical",
  "pregnant",
  "pregnancy",
  "medication",
  "pain",
  "dizziness",
  "eating disorder",
  "anorexia",
  "bulimia",
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "not working",
];

/**
 * Check if a message should be escalated based on keyword matching.
 * @param {string} messageText - The incoming message text
 * @returns {{ shouldEscalate: boolean, reason: string }}
 */
function checkEscalation(messageText) {
  if (!messageText) {
    return { shouldEscalate: false, reason: "" };
  }

  const lower = messageText.toLowerCase();

  for (const keyword of ESCALATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        shouldEscalate: true,
        reason: `Message contains escalation keyword: "${keyword}"`,
      };
    }
  }

  return { shouldEscalate: false, reason: "" };
}

/**
 * Notify Maddy via WhatsApp about an escalation.
 * @param {string} reason - Escalation reason
 * @param {{ phone?: string, message?: string }} context - Context about the lead
 */
async function notifyMaddy(reason, context) {
  const maskedPhone = context.phone ? maskPhone(context.phone) : "unknown";
  const body =
    `ESCALATION ALERT\n` +
    `Reason: ${reason}\n` +
    `Lead phone: ${maskedPhone}\n` +
    `Message: ${context.message || "N/A"}`;

  try {
    await sendText(MADDY_PHONE, body);
  } catch (err) {
    console.error(`[escalation] Failed to notify Maddy: ${err.message}`);
  }
}

module.exports = { checkEscalation, notifyMaddy };
