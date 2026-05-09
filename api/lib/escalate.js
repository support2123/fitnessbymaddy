const { getSupabase } = require('./supabase');
const { sendWhatsApp, maskPhone } = require('./whatsapp');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalateToMaddy(phone, reason, messageBody) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 200)
  ]);

  return { escalated: true };
}

module.exports = { escalateToMaddy };
