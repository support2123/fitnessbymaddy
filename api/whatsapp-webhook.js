const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const {
  detectMarket, classifyIntent, needsEscalation, isOptOut,
  isHinglish, programDisplayName, cors, maskPhone,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body || {};
    const phone = body.mobile || body.phone || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        clientName: senderName,
        details: message.slice(0, 200),
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_message', handled: true });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeMsg = hinglish
        ? [senderName || 'there', 'fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : [senderName || 'there', 'fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'];

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: welcomeMsg,
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', ignored: true });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead.id);

    const intent = classifyIntent(message);

    if (intent) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent,
      }).eq('id', lead.id);

      const displayName = programDisplayName(intent);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const qualifyMsg = hinglish
        ? [senderName || 'there', displayName, checkoutUrl, intakeUrl]
        : [senderName || 'there', displayName, checkoutUrl, intakeUrl];

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        bodyValues: qualifyMsg,
      });

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'message_received' });

  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.mobile || ''), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
