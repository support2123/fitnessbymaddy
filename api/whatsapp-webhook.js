const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, isOptOut, isEscalation, getCheckoutUrl, PROGRAM_CHECKOUT, jsonResponse, errorResponse } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const message = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    // Log inbound message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    // Check opt-out
    if (isOptOut(message)) {
      await db.from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check for escalation triggers
    if (isEscalation(message)) {
      await notifyMaddy(db, phone, message, 'escalation');
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await db.from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — log and let human handle or route to support
      console.log(`Active client message from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'client_message_logged' });
    }

    if (!existingLead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const intent = classifyIntent(message);

      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        program_interest: intent,
        market,
      }).select().single();

      // Send welcome template
      const welcomeMsg = market === 'IN'
        ? `Hi${senderName ? ' ' + senderName : ''}! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
        : `Hi${senderName ? ' ' + senderName : ''}! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?`;

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      await db.from('messages').insert({
        phone,
        direction: 'out',
        body: welcomeMsg,
        template_name: 'welcome_v1',
        sent_at: new Date().toISOString(),
        status: 'sent',
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    // FLOW B: Lead qualification — classify reply
    const intent = classifyIntent(message);

    if (intent) {
      const program = PROGRAM_CHECKOUT[intent];
      const checkoutUrl = getCheckoutUrl(intent);
      const market = existingLead.market || detectMarket(phone);

      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent,
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      const qualifyMsg = market === 'IN'
        ? `Great choice! 🔥 ${program.name} — perfect for you.\n\n💰 Price: $${program.price}\n🛒 Checkout: ${checkoutUrl}\n\n📋 Intake form bhi fill karo taki hum best plan bana sakein:\nhttps://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        : `Great choice! 🔥 ${program.name} — perfect for your goals.\n\n💰 Price: $${program.price}\n🛒 Checkout: ${checkoutUrl}\n\n📋 Please fill out the intake form so we can build your best plan:\nhttps://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      await sendText(phone, qualifyMsg);

      await db.from('messages').insert({
        phone,
        direction: 'out',
        body: qualifyMsg,
        template_name: 'qualify_program',
        sent_at: new Date().toISOString(),
        status: 'sent',
      });

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    // No clear intent — update last_msg and acknowledge
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function notifyMaddy(db, phone, message, reason) {
  const masked = maskPhone(phone);
  const notification = `🚨 ESCALATION (${reason})\nFrom: ${masked}\nMessage: ${message}`;

  // Send to Maddy's personal number
  try {
    await sendText('+917082478374', notification);
  } catch (e) {
    console.error('Failed to notify Maddy:', e.message);
  }

  await db.from('messages').insert({
    phone: '+917082478374',
    direction: 'out',
    body: notification,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'sent',
  });
}
