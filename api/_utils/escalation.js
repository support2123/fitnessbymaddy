const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function notifyMaddy(reason, details) {
  const msg = `🚨 ESCALATION: ${reason}\n${details}`;
  console.log(`Escalation: ${reason} | ${details.replace(/\+\d+/g, (m) => maskPhone(m))}`);
  await sendTemplate(MADDY_PHONE, 'escalation_alert', [reason, details.slice(0, 200)]);
}

function checkEscalationTriggers(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  const triggers = [
    { pattern: /\b(refund|money back|paisa wapas)\b/, reason: 'Refund request' },
    { pattern: /\b(lawyer|legal|consumer court|complaint)\b/, reason: 'Legal/complaint mention' },
    { pattern: /\b(didn'?t work|no results|scam|fraud|fake)\b/, reason: 'Negative feedback' },
    { pattern: /\b(side effect|adverse|reaction|allergy)\b/, reason: 'Side effect report' },
    { pattern: /\b(injur|pain|hurt|fracture|torn|hernia)\b/, reason: 'Injury report' },
    { pattern: /\b(pregnant|pregnancy|expecting)\b/, reason: 'Pregnancy mention' },
    { pattern: /\b(medication|medicine|drug|thyroid|diabetes|bp|blood pressure)\b/, reason: 'Medical condition' },
    { pattern: /\b(dizzy|faint|chest.?pain|breathless|nausea)\b/, reason: 'Health emergency signal' },
    { pattern: /\b(eating disorder|anorex|bulimi|purge|starv)\b/, reason: 'Disordered eating signal' },
  ];

  for (const t of triggers) {
    if (t.pattern.test(lower)) return t.reason;
  }
  return null;
}

module.exports = { notifyMaddy, checkEscalationTriggers };
