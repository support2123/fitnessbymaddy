const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy({ reason, phone, details }) {
  const masked = maskPhone(phone);
  const message = [
    `ESCALATION: ${reason}`,
    `Lead/Client: ${masked}`,
    details ? `Details: ${details.slice(0, 200)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, masked, (details || '').slice(0, 200)],
  });
}

module.exports = { escalateToMaddy, MADDY_PHONE };
