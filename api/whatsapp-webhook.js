const { supabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, matchProgram, needsEscalation, isOptOut, cors } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { phone, message, name } = parsePayload(req.body);
  if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

  await logIncoming(phone, message);

  if (isOptOut(message)) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    const client = await supabase.from('clients').select('id').eq('phone', phone).single();
    await escalate(phone, 'keyword_trigger', message, client.data?.id);
  }

  const existing = await supabase.from('leads').select('*').eq('phone', phone).single();

  if (!existing.data) {
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    });

    const welcomeMsg = market === 'IN'
      ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

    await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');
    return res.json({ action: 'new_lead_welcomed', market });
  }

  await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existing.data.status === 'dropped') {
    return res.json({ action: 'lead_dropped_no_action' });
  }

  if (existing.data.status === 'new') {
    const match = matchProgram(message);
    if (match) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
      }).eq('phone', phone);

      const market = existing.data.market;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.data.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existing.data.id}`;

      const qualMsg = market === 'IN'
        ? `Great choice! ${match.name} ($${match.price}) perfect hai tere goal ke liye.\n\nCheckout: ${checkoutUrl}\n\nOnce payment done, ye form fill karo:\n${intakeUrl}`
        : `Great choice! ${match.name} ($${match.price}) is perfect for your goal.\n\nCheckout: ${checkoutUrl}\n\nOnce payment is done, fill this form:\n${intakeUrl}`;

      await sendWhatsApp(phone, qualMsg, null);
      return res.json({ action: 'qualified', program: match.program });
    }
  }

  return res.json({ action: 'message_logged' });
};

function parsePayload(body) {
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name,
    };
  }
  return {
    phone: body?.phone || body?.mobile || body?.from,
    message: body?.message || body?.text || body?.body || '',
    name: body?.name || body?.userName,
  };
}
