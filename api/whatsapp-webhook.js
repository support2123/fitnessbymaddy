const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendTo, maskPhone } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, needsEscalation, isOptOut } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.senderPhone || body.from || body.waId;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'keyword_trigger', text);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_reply', client_id: existingClient[0].id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      const lead = existingLead[0];

      if (lead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      const intent = classifyIntent(text);
      if (intent) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: intent.program })
          .eq('id', lead.id);

        const market = detectMarket(phone);
        const msg =
          market === 'IN'
            ? `Great choice! ${intent.name} program — ${intent.price} USD mein full access milega. Yahan se start karo:`
            : `Great choice! The ${intent.name} program is $${intent.price}. Get started here:`;

        await sendText(phone, `${msg}\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${intent.program}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${lead.id}`);

        return res.status(200).json({ action: 'qualified', program: intent.program });
      }

      return res.status(200).json({ action: 'existing_lead_reply' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      })
      .select()
      .single();

    const welcomeMsg =
      market === 'IN'
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

    const intent = classifyIntent(text);
    if (intent) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: intent.program })
        .eq('id', newLead.id);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
