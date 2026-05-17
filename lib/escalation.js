const { supabase } = require('./supabase');
const { sendText, maskPhone, MADDY_PHONE } = require('./whatsapp');

async function escalateToMaddy(phone, reason, messageBody) {
  const clientLookup = await supabase
    .from('clients')
    .select('id, name')
    .eq('phone', phone)
    .limit(1);

  const clientId = clientLookup.data?.[0]?.id || null;
  const clientName = clientLookup.data?.[0]?.name || 'Unknown';

  await supabase.from('escalations').insert({
    phone,
    client_id: clientId,
    reason,
    message_body: messageBody
  });

  const masked = maskPhone(phone);
  const alert = `ESCALATION ALERT\n\nClient: ${clientName} (${masked})\nReason: ${reason}\nMessage: "${messageBody?.slice(0, 200) || 'N/A'}"\n\nPlease review in admin dashboard.`;

  await sendText(MADDY_PHONE, alert);

  return { escalated: true };
}

module.exports = { escalateToMaddy };
