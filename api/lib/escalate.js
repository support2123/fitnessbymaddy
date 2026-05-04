const { getSupabase } = require('./supabase');
const { sendTemplate } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '917082478374';

async function escalate(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    trigger_reason: reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 200)
  ]);
}

module.exports = { escalate };
