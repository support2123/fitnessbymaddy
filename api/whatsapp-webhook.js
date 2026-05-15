const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish, needsEscalation, routeProgram, isOptOut, jsonResponse } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

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
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    console.log(`Incoming WA from ${maskPhone(phone)}: ${text.slice(0, 50)}`);

    const db = getSupabase();

    // Log inbound message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    // Opt-out check
    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Sensitive keyword detected',
        `Phone: ${maskPhone(phone)} — "${text.slice(0, 100)}"`
      );
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — log and skip auto-reply
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      // FLOW A: New lead
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    // FLOW B: Lead qualification — try to route based on reply
    const program = routeProgram(text);

    if (program) {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: program,
          last_msg_at: new Date().toISOString(),
        })
        .eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const programLabel = require('./lib/helpers').PROGRAM_NAMES[program];

      const replyParams = hinglish
        ? [`Great choice! 🔥 ${programLabel} program ready hai tere liye.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form bhi fill karo: ${intakeUrl}`]
        : [`Great choice! 🔥 The ${programLabel} program is perfect for you.\n\n💳 Checkout: ${checkoutUrl}\n📋 Please fill the intake form: ${intakeUrl}`];

      await sendWhatsApp(phone, 'program_recommendation', replyParams);

      return res.status(200).json({ action: 'lead_qualified', program });
    }

    // Update last message timestamp
    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
