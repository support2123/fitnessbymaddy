const { sendText, maskPhone } = require("./whatsapp");

const ESCALATION_PATTERNS = [
  { pattern: /\binjur(y|ed|ies)\b/i, reason: "injury" },
  { pattern: /\bmedical\b/i, reason: "medical condition" },
  { pattern: /\bpregnan(t|cy)\b/i, reason: "pregnancy" },
  { pattern: /\bmedication\b/i, reason: "medication" },
  { pattern: /\bpain\b/i, reason: "pain reported" },
  { pattern: /\bdizz(y|iness)\b/i, reason: "dizziness" },
  { pattern: /\b(eating disorder|binge|purge|anorexi|bulimi)\b/i, reason: "disordered eating signals" },
  { pattern: /\brefund\b/i, reason: "refund request" },
  { pattern: /\blawyer\b/i, reason: "legal threat" },
  { pattern: /\bcomplaint\b/i, reason: "complaint" },
  { pattern: /didn.t work/i, reason: "program complaint" },
  { pattern: /\bside effect/i, reason: "side effect reported" },
  { pattern: /\b(suicid|self.harm|kill myself)\b/i, reason: "mental health crisis" },
];

function checkEscalation(messageBody) {
  if (!messageBody) return { shouldEscalate: false, reason: null };
  for (const { pattern, reason } of ESCALATION_PATTERNS) {
    if (pattern.test(messageBody)) {
      return { shouldEscalate: true, reason };
    }
  }
  return { shouldEscalate: false, reason: null };
}

async function notifyMaddy(reason, context) {
  const maddyPhone = process.env.MADDY_PHONE;
  if (!maddyPhone) {
    console.error("MADDY_PHONE not configured, cannot send escalation");
    return;
  }

  const phone = context.phone || context.clientPhone || "unknown";
  const message = context.message || context.messageBody || "";
  const name = context.name || "Unknown";

  const msg = `🚨 ESCALATION ALERT\n\nReason: ${reason}\nFrom: ${maskPhone(phone)}\nName: ${name}\nMessage: "${message.slice(0, 200)}"`;

  await sendText(maddyPhone, msg);
}

module.exports = { checkEscalation, notifyMaddy };
