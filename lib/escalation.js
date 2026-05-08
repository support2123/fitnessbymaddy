const { sendWhatsAppForced } = require("./whatsapp");

const MADDY_PHONE = "917082478374";

const ESCALATION_KEYWORDS = [
  "refund",
  "lawyer",
  "complaint",
  "didn't work",
  "side effect",
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
  "not eating",
  "vomiting",
];

function needsEscalation(messageText) {
  if (!messageText) return false;
  const lower = messageText.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function isOptOut(messageText) {
  if (!messageText) return false;
  const lower = messageText.trim().toLowerCase();
  return lower === "stop" || lower === "unsubscribe";
}

async function escalateToMaddy(reason, leadPhone, messageBody) {
  const masked = leadPhone
    ? leadPhone.slice(0, 4) + "XXX..." + leadPhone.slice(-3)
    : "unknown";
  await sendWhatsAppForced(MADDY_PHONE, "escalation_alert", [
    reason,
    masked,
    (messageBody || "").slice(0, 200),
  ]);
}

module.exports = { needsEscalation, isOptOut, escalateToMaddy, MADDY_PHONE };
