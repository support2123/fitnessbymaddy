const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const body = req.body;

  const phone = body.senderPhone || body.waId || body.from;
  const message = body.message || body.text || body.body || '';
  const name = body.senderName || body.pushName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number in payload' });
  }

  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'in',
    body: message.substring(0, 1000),
    template_name: null,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  const lower = message.toLowerCase().trim();
  if (lower === 'stop' || lower === 'unsubscribe') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy(
      'Keyword trigger in message',
      `From: ${maskPhone(phone)} | Msg: ${message}`
    );
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const welcomeParams = market === 'IN'
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?'];

    await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
    return res.status(200).json({ action: 'new_lead_greeted', market });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'new') {
    const qualified = qualifyLead(message);
    if (qualified) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualified.program
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${qualified.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgParams = market === 'IN'
        ? [qualified.name, `$${qualified.price}`, checkoutUrl, intakeUrl]
        : [qualified.name, `$${qualified.price}`, checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_offer', msgParams);
      return res.status(200).json({ action: 'qualified', program: qualified.program });
    }

    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Active client flagged message',
        `Client: ${existingClient.name} | Msg: ${message}`
      );
      return res.status(200).json({ action: 'escalated_to_maddy' });
    }
    return res.status(200).json({ action: 'active_client_message_logged' });
  }

  return res.status(200).json({ action: 'message_logged' });
};
