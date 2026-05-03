const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, details) {
  const msg = `ESCALATION: ${reason}\n${details}`;
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, details.slice(0, 200)]
  });
  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
