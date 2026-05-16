const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { checkEscalation, classifyIntent, handleEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.escalate) {
      await handleEscalation(phone, message, escalation.trigger);
      return res.status(200).json({ action: 'escalated', trigger: escalation.trigger });
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
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const intent = classifyIntent(message);
    if (intent) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent.program
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, 'program_offer', {
        name: existingLead.name || name || 'there',
        templateParams: [
          existingLead.name || name || 'there',
          intent.name,
          `$${intent.price}`,
          checkoutUrl,
          intakeUrl
        ]
      });

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
