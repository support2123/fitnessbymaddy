const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, canSendToLead, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, detectProgram, programLabel, needsEscalation, isOptOut, isHinglish, jsonResponse } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const message = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: message.slice(0, 500),
      status: 'received',
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      await db.from('escalations').insert({
        phone: maskPhone(phone),
        client_id: existingClient?.id || null,
        reason: 'keyword_trigger',
        message_body: message.slice(0, 500),
      });

      await sendWhatsApp({
        phone: process.env.MADDY_PHONE || phone,
        templateName: 'escalation_alert',
        bodyValues: [maskPhone(phone), message.slice(0, 200)],
      });

      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: lead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const greeting = isHinglish(market)
        ? 'Hi! Maddy ki team se 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        bodyValues: [name || 'there', greeting],
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const label = programLabel(program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgBody = isHinglish(market)
        ? `Great choice! 💪 ${label} aapke liye perfect hai.\n\nPayment link: ${checkoutUrl}\n\nAur ye form bhi fill kar do: ${intakeUrl}`
        : `Great choice! 💪 ${label} is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nAlso fill out this quick form: ${intakeUrl}`;

      await sendWhatsApp({
        phone,
        templateName: 'program_recommendation',
        bodyValues: [name || 'there', label, checkoutUrl, intakeUrl],
      });

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'no_match', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
