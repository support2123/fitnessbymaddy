const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, maskPhone, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body;
    const phone = body.phone || body.sender || body.from;
    const message = body.message || body.text || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      const intent = classifyIntent(message);
      if (intent.escalate) {
        await handleEscalation(db, phone, intent.keyword, message);
        return res.json({ action: 'escalated' });
      }
      if (intent.optout) {
        await db.from('clients').update({ status: 'paused' }).eq('id', existingClient.id);
        return res.json({ action: 'opted_out' });
      }
      return res.json({ action: 'active_client_message_logged' });
    }

    if (existingLead && existingLead.status === 'dropped') {
      const intent = classifyIntent(message);
      if (intent.optout) return res.json({ action: 'already_dropped' });

      await db.from('leads').update({
        status: 'new',
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);
    }

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
      });

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy ki team se 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! This is Maddy\'s team 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      return res.json({ action: 'new_lead_welcomed' });
    }

    const intent = classifyIntent(message);

    if (intent.optout) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
      return res.json({ action: 'opted_out' });
    }

    if (intent.escalate) {
      await handleEscalation(db, phone, intent.keyword, message);
      return res.json({ action: 'escalated' });
    }

    if (intent.program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent.program,
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgParams = market === 'IN'
        ? [
            `Bahut badhiya! 🔥 Aapke liye perfect program mil gaya.`,
            `Checkout: ${checkoutUrl}`,
            `Intake form bhi fill kardo: ${intakeUrl}`,
          ]
        : [
            `Great choice! 🔥 We've found the perfect program for you.`,
            `Checkout: ${checkoutUrl}`,
            `Please also fill out your intake form: ${intakeUrl}`,
          ];

      await sendWhatsApp(phone, 'program_match', msgParams);
      return res.json({ action: 'qualified', program: intent.program });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleEscalation(db, phone, keyword, context) {
  await db.from('escalations').insert({
    phone,
    reason: keyword,
    context,
  });

  const maddyPhone = process.env.MADDY_PHONE || '+917082478374';
  await sendWhatsApp(maddyPhone, 'escalation_alert', [
    `ESCALATION: Lead ${maskPhone(phone)} mentioned "${keyword}"`,
    context.slice(0, 200),
  ]);
}
