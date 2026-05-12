const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy({ reason, phone, clientName, details }) {
  const masked = maskPhone(phone);
  const message = [
    `ESCALATION: ${reason}`,
    `Client: ${clientName || 'Unknown'} (${masked})`,
    details ? `Details: ${details}` : '',
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    bodyValues: [reason, clientName || 'Unknown', masked, details || 'N/A'],
  });

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
