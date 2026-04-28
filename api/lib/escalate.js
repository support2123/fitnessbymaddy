const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function notifyMaddy(reason, context) {
  const msg = `🚨 ESCALATION\nReason: ${reason}\nClient: ${context.name || 'Unknown'}\nPhone: ${maskPhone(context.phone)}\nDetails: ${context.details || 'N/A'}`;

  await sendTemplate(MADDY_PHONE, 'escalation_alert', {
    name: 'Maddy',
    templateParams: [reason, context.name || 'Unknown', context.details || ''],
  });

  return msg;
}

module.exports = { notifyMaddy };
