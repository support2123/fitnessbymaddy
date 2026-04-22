const { getSupabase } = require('./supabase');
const { sendWhatsApp } = require('./whatsapp');
const { maskPhone } = require('./helpers');

const MADDY_PHONE = '+917082478374';

async function escalate(phone, reason, triggerMessage, clientId) {
  const db = getSupabase();

  await db.from('escalations').insert({
    phone,
    client_id: clientId || null,
    reason,
    trigger_message: triggerMessage,
  });

  const masked = maskPhone(phone);
  await sendWhatsApp(MADDY_PHONE, 'escalation_alert', [
    reason,
    masked,
    (triggerMessage || '').slice(0, 100),
  ]);

  console.log(`[ESCALATION] ${reason} from ${masked}`);
}

module.exports = { escalate };
