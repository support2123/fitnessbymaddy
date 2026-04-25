const { supabase } = require('./supabase');
const { sendTemplate, maskPhone } = require('./whatsapp');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy(phone, reason, messageBody, clientId) {
  await supabase.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    message_body: messageBody
  });

  await sendTemplate(MADDY_PHONE, 'escalation_alert', [
    reason,
    maskPhone(phone),
    (messageBody || '').slice(0, 200)
  ]);

  console.log(`Escalation: ${reason} for ${maskPhone(phone)}`);
}

module.exports = { escalateToMaddy };
