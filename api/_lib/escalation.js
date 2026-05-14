const { sendWhatsApp, maskPhone } = require('./whatsapp');
const { getSupabase } = require('./supabase');

const MADDY_PHONE = '+917082478374';

async function escalateToMaddy({ reason, phone, clientName, details }) {
  const db = getSupabase();

  const message = [
    `ESCALATION: ${reason}`,
    `Client: ${clientName || 'Unknown'}`,
    `Phone: ${maskPhone(phone)}`,
    details ? `Details: ${details}` : ''
  ].filter(Boolean).join('\n');

  await sendWhatsApp({
    phone: MADDY_PHONE,
    templateName: 'escalation_alert',
    body: message,
    params: [reason, clientName || 'Unknown', details || 'N/A']
  });

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `[ESCALATION] ${reason} — ${maskPhone(phone)}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent'
  });
}

module.exports = { escalateToMaddy };
