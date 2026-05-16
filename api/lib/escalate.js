const { sendWhatsApp } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(reason, context = {}) {
  const msg = `🚨 ESCALATION\nReason: ${reason}\nClient: ${context.name || 'Unknown'}\nPhone: ${context.phone || 'N/A'}\nDetails: ${context.details || 'None'}`;

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.name || 'Unknown', context.details || '']
  }, true);

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy };
