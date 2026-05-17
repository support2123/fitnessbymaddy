const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, isHinglish, PROGRAM_NAMES } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number in payload' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(phone, 'keyword_trigger', text);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_message', note: 'Logged for review' });
    }

    const market = detectMarket(phone);

    if (!existingLead || existingLead.length === 0) {
      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      });

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const program = detectProgram(text);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', lead.id);

      const programName = PROGRAM_NAMES[program] || program;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

      const hinglish = isHinglish(market);
      let msg;
      if (hinglish) {
        msg = `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout karo: ${checkoutUrl}\n\nAur yeh intake form bhi fill karo taaki Maddy aapka plan bana sake:\n${intakeUrl}`;
      } else {
        msg = `Great choice! The ${programName} is perfect for your goals.\n\nComplete your checkout: ${checkoutUrl}\n\nAlso fill out this intake form so Maddy can build your plan:\n${intakeUrl}`;
      }

      await sendText(phone, msg);
      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
