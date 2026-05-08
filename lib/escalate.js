const { sendWhatsApp, maskPhone } = require('./whatsapp');
const { Resend } = require('resend');

const MADDY_PHONE = '917082478374';

async function escalateToMaddy(reason, phone, details) {
  await sendWhatsApp(
    MADDY_PHONE,
    'escalation_alert',
    [reason, maskPhone(phone), details || 'No additional details']
  );

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `[ESCALATION] ${reason}`,
      text: `Lead/Client phone: ${maskPhone(phone)}\nReason: ${reason}\nDetails: ${details || 'N/A'}`,
    });
  } catch (_) {
    // Email is best-effort backup
  }
}

module.exports = { escalateToMaddy };
