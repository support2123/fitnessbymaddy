const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const message = `ESCALATION: ${reason}\n${JSON.stringify(details, null, 2)}`;
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, details.phone || 'unknown']);
  console.log(`[ESCALATION] ${reason} — ${details.phone ? details.phone.substring(0, 5) + '...' : 'no phone'}`);
}

module.exports = { escalateToMaddy };
