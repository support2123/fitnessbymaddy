const { sendText } = require("./whatsapp");
const { Resend } = require("resend");

const MADDY_PHONE = "+917082478374";
const SUPPORT_EMAIL = "support@fitnessbymaddy.com";

const TRIGGER_WORDS = [
  "injury",
  "medical",
  "pregnant",
  "pregnancy",
  "medication",
  "pain",
  "dizziness",
  "dizzy",
  "eating disorder",
  "anorexia",
  "bulimia",
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
];

async function checkEscalation(message, clientOrLead) {
  const lower = (message || "").toLowerCase();
  const matched = TRIGGER_WORDS.filter((kw) => lower.includes(kw));

  if (matched.length === 0) {
    return { escalated: false, reason: null };
  }

  const reason = `Trigger words detected: ${matched.join(", ")}`;
  const contactName = clientOrLead?.name || "Unknown";
  const contactPhone = clientOrLead?.phone || "Unknown";

  const whatsappMsg =
    `ESCALATION ALERT\n` +
    `Contact: ${contactName} (${contactPhone})\n` +
    `Triggers: ${matched.join(", ")}\n` +
    `Message: ${message}`;

  try {
    await sendText(MADDY_PHONE, whatsappMsg);
  } catch (err) {
    console.error("Escalation WhatsApp notification failed:", err.message);
  }

  try {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: "FitnessByMaddy <notifications@fitnessbymaddy.com>",
        to: SUPPORT_EMAIL,
        subject: `Escalation: ${matched.join(", ")} — ${contactName}`,
        text:
          `An escalation has been triggered.\n\n` +
          `Contact: ${contactName}\n` +
          `Phone: ${contactPhone}\n` +
          `Trigger words: ${matched.join(", ")}\n\n` +
          `Original message:\n${message}`,
      });
    }
  } catch (err) {
    console.error("Escalation email notification failed:", err.message);
  }

  return { escalated: true, reason };
}

module.exports = { checkEscalation };
