const { sendWhatsAppDirect } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy({ reason, phone, details }) {
  const masked = maskPhone(phone);
  const body = `ESCALATION: ${reason}\nLead/Client: ${masked}\n${details || ''}`;

  await sendWhatsAppDirect({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body,
    params: [reason, masked, details || 'See dashboard for details']
  });

  return { escalated: true, reason };
}

module.exports = { escalateToMaddy, MADDY_PHONE };
