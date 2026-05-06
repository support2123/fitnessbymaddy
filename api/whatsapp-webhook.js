const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, canSendToLead, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, detectProgram, isOptOut, PROGRAM_NAMES, CHECKOUT_URLS } = require('./_lib/utils');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const text = payload.text || payload.body || payload.message || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name, message: text });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const program = detectProgram(text);
      if (program && !existingLead.program_interest) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = detectMarket(phone);
        const isHinglish = market === 'IN';

        const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = isHinglish
          ? `Perfect choice! 🎯 ${PROGRAM_NAMES[program]} tere liye best rahega.\n\nPehle ye form fill karo: ${intakeUrl}\n\nFir yahan se enroll karo: ${checkoutUrl}`
          : `Perfect choice! 🎯 ${PROGRAM_NAMES[program]} is ideal for you.\n\nFirst, fill out this form: ${intakeUrl}\n\nThen enroll here: ${checkoutUrl}`;

        if (await canSendToLead(phone)) {
          await sendText(phone, msg);
        }
      }

      return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      })
      .select('id')
      .single();

    const isHinglish = market === 'IN';
    const welcomeMsg = isHinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendText(phone, welcomeMsg);

    setTimeout(async () => {
      const { data: lead } = await supabase
        .from('leads')
        .select('status, program_interest')
        .eq('id', newLead.id)
        .single();

      if (lead && lead.status === 'new' && !lead.program_interest) {
        const nudge = isHinglish
          ? "Hey! 👋 Maddy ka $20 trial session try karo — live Zoom pe full guidance milegi. Book karo: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial"
          : "Hey! 👋 Try Maddy's $20 trial session — full guidance on a live Zoom call. Book here: https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial";

        if (await canSendToLead(phone)) {
          await sendText(phone, nudge);
        }
      }
    }, 2 * 60 * 60 * 1000);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
