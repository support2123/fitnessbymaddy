const { supabase } = require('./lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, maskPhone, jsonResponse, errorResponse } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    const intent = classifyIntent(message);

    if (intent && intent.type === 'optout') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent && intent.type === 'escalation') {
      await sendEscalation(
        `ESCALATION: Lead ${maskPhone(phone)} mentioned "${intent.keyword}". Message: "${message.slice(0, 200)}"`
      );
      return res.status(200).json({ action: 'escalated', keyword: intent.keyword });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const greeting = market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, greeting, 'welcome_v1');

      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', note: 'No further messages' });
    }

    if (intent && intent.type === 'program') {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: intent.program,
        })
        .eq('id', existingLead.id);

      const market = detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const replyMsg = market === 'IN'
        ? `Great choice! ${intent.name} program perfect rahega aapke liye 💪\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill kar do: ${intakeUrl}`
        : `Great choice! The ${intent.name} program is perfect for you 💪\n\nCheckout: ${checkoutUrl}\n\nAlso fill out your intake form: ${intakeUrl}`;

      await sendWhatsApp(phone, replyMsg);

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    return res.status(200).json({ action: 'received', note: 'No matching intent' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
