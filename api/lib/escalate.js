const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const message = `🚨 ESCALATION: ${reason}\n${details}`;
  console.log(`Escalating to Maddy: ${reason} — ${maskPhone(details)}`);

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [reason, details]);
  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
