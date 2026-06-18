const { sendWhatsApp } = require("./whatsapp");
const { sendEmail } = require("./email");

const MADDY_PHONE = "+917082478374";
const SUPPORT_EMAIL = "support@fitnessbymaddy.com";

/**
 * Keywords that trigger an automatic escalation to Maddy.
 * All matching is case-insensitive.
 */
const ESCALATION_KEYWORDS = [
  { keyword: "injury", reason: "Possible injury concern" },
  { keyword: "medical", reason: "Medical issue mentioned" },
  { keyword: "pregnant", reason: "Pregnancy mentioned" },
  { keyword: "pregnancy", reason: "Pregnancy mentioned" },
  { keyword: "medication", reason: "Medication mentioned" },
  { keyword: "pain", reason: "Pain reported" },
  { keyword: "dizziness", reason: "Dizziness reported" },
  { keyword: "eating disorder", reason: "Eating disorder concern" },
  { keyword: "refund", reason: "Refund request" },
  { keyword: "lawyer", reason: "Legal concern raised" },
  { keyword: "complaint", reason: "Complaint filed" },
  { keyword: "didn't work", reason: "Program effectiveness concern" },
  { keyword: "side effect", reason: "Side effect reported" },
  { keyword: "vomit", reason: "Health emergency — vomiting" },
  { keyword: "faint", reason: "Health emergency — fainting" },
];

/**
 * Check whether a message contains escalation-triggering keywords.
 *
 * @param {string} messageText  The raw message from the user
 * @returns {{ shouldEscalate: boolean, reason: string }}
 */
function checkEscalation(messageText) {
  if (!messageText) {
    return { shouldEscalate: false, reason: "" };
  }

  const lower = messageText.toLowerCase();

  for (const entry of ESCALATION_KEYWORDS) {
    if (lower.includes(entry.keyword)) {
      return { shouldEscalate: true, reason: entry.reason };
    }
  }

  return { shouldEscalate: false, reason: "" };
}

/**
 * Notify Maddy of an escalation via WhatsApp and email.
 *
 * @param {string} reason   Short description of why this was escalated
 * @param {object} context  Additional context (phone, message, leadId, etc.)
 */
async function notifyMaddy(reason, context = {}) {
  const summary = [
    `ESCALATION: ${reason}`,
    context.phone ? `Phone: ${context.phone}` : null,
    context.leadId ? `Lead ID: ${context.leadId}` : null,
    context.message ? `Message: "${context.message}"` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Send WhatsApp notification to Maddy
  try {
    await sendWhatsApp(MADDY_PHONE, "escalation_alert", [
      reason,
      context.phone || "Unknown",
      context.message || "N/A",
    ]);
  } catch (err) {
    console.error("[escalation] Failed to WhatsApp Maddy:", err.message);
  }

  // Send email notification
  try {
    await sendEmail(
      SUPPORT_EMAIL,
      `[ESCALATION] ${reason}`,
      `<div style="font-family: sans-serif; max-width: 600px;">
        <h2 style="color: #e53e3e;">Escalation Alert</h2>
        <p><strong>Reason:</strong> ${reason}</p>
        ${context.phone ? `<p><strong>Phone:</strong> ${context.phone}</p>` : ""}
        ${context.leadId ? `<p><strong>Lead ID:</strong> ${context.leadId}</p>` : ""}
        ${context.message ? `<p><strong>Message:</strong> "${context.message}"</p>` : ""}
        <hr />
        <p style="color: #718096; font-size: 12px;">
          Automated escalation from FitnessByMaddy bot.
          Review and respond as soon as possible.
        </p>
      </div>`
    );
  } catch (err) {
    console.error("[escalation] Failed to email Maddy:", err.message);
  }

  console.log("[escalation] Notified Maddy:", summary);
}

module.exports = { checkEscalation, notifyMaddy };
