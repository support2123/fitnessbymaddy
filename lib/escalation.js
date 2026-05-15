const { supabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

async function escalate(phone, reason, triggerMessage, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage,
  });

  const masked = maskPhone(phone);
  const alertMsg = `ESCALATION\nFrom: ${masked}\nReason: ${reason}\nMessage: "${(triggerMessage || '').slice(0, 200)}"`;

  await sendWhatsApp(MADDY_PHONE, alertMsg, null);

  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'FitnessByMaddy Alerts <support@fitnessbymaddy.com>',
      to: 'support@fitnessbymaddy.com',
      subject: `Escalation: ${reason}`,
      text: `Phone: ${masked}\nReason: ${reason}\nMessage: ${triggerMessage}`,
    }).catch(() => {});
  }
}

module.exports = { escalate };
