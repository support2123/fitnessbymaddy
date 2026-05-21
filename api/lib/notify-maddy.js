const { sendTemplateForced, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';

async function notifyMaddy(subject, details) {
  const msg = `ALERT: ${subject}\n${details}`;
  console.log(`Escalation to Maddy: ${subject}`);

  try {
    await sendTemplateForced(MADDY_PHONE, 'admin_alert', {
      name: 'Maddy',
      templateParams: [subject, details.slice(0, 900)]
    });
  } catch (err) {
    console.error('Failed to notify Maddy:', err.message);
  }

  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'FitnessByMaddy Automation <support@fitnessbymaddy.com>',
        to: 'support@fitnessbymaddy.com',
        subject: `[ESCALATION] ${subject}`,
        text: details
      });
    } catch (err) {
      console.error('Email notification failed:', err.message);
    }
  }
}

module.exports = { notifyMaddy };
