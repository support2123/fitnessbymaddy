const { sendWhatsApp, maskPhone } = require("./whatsapp");

const MADDY_PHONE = "+917082478374";

const ESCALATION_KEYWORDS = [
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
  "injury",
  "pain",
  "dizziness",
  "pregnant",
  "pregnancy",
  "medication",
  "medical",
  "eating disorder",
  "not eating",
  "throwing up",
  "vomiting",
];

function needsEscalation(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

async function escalateToMaddy(reason, leadPhone, context) {
  const masked = maskPhone(leadPhone);
  const msg = `ESCALATION: ${reason}\nLead: ${masked}\nContext: ${context}`;
  console.log(`[ESCALATION] ${reason} for ${masked}`);

  try {
    await sendWhatsApp(MADDY_PHONE, "escalation_alert", {
      name: "Maddy",
      templateParams: [reason, masked, context.slice(0, 200)],
    });
  } catch (err) {
    console.error("[ESCALATION] Failed to notify Maddy:", err.message);
  }

  return msg;
}

module.exports = { needsEscalation, escalateToMaddy, ESCALATION_KEYWORDS };
