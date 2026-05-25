const { supabase } = require('./supabase');
const { sendText } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

async function escalate(phone, reason, messageBody) {
  await supabase.from('escalations').insert({
    phone,
    reason,
    message_body: messageBody
  });

  const alert = `🚨 ESCALATION\nFrom: ${maskPhone(phone)}\nReason: ${reason}\n\nMessage: "${(messageBody || '').slice(0, 200)}"`;
  await sendText(MADDY_PHONE, alert, true);
}

module.exports = { escalate };
