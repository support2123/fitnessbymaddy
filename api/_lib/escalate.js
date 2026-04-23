const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./utils');

const MADDY_PHONE = '+917082478374';

async function escalate(phone, reason, messageBody, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  const alertText =
    `ESCALATION ALERT\n` +
    `From: ${masked}\n` +
    `Reason: ${reason}\n` +
    `Message: "${(messageBody || '').slice(0, 200)}"`;

  await sendWhatsApp(MADDY_PHONE, alertText, 'escalation_alert');
}

module.exports = { escalate };
