const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');
const {
  detectMarket,
  isHinglish,
  needsEscalation,
  classifyIntent,
  PROGRAM_DETAILS,
  corsHeaders,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (/stop|unsubscribe|opt.?out/i.test(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected in message', {
        phone,
        message: message.slice(0, 200),
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const intent = classifyIntent(message);

    if (intent && PROGRAM_DETAILS[intent]) {
      const program = PROGRAM_DETAILS[intent];

      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: intent,
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const qualifyParams = hinglish
        ? [
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl,
          ]
        : [
            program.name,
            `$${program.price}`,
            checkoutUrl,
            intakeUrl,
          ];

      await sendWhatsApp(phone, 'program_recommendation', qualifyParams);

      return res.status(200).json({
        action: 'qualified',
        program: intent,
        lead_id: existingLead.id,
      });
    }

    return res.status(200).json({ action: 'no_match', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
