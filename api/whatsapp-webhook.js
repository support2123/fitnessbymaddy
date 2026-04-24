const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendToLead } = require('../lib/whatsapp');
const {
  maskPhone, detectMarket, isHinglish, needsEscalation,
  matchProgram, isOptOut, corsHeaders, PROGRAM_NAMES,
} = require('../lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({ ok: true });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.mobile || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendText(MADDY_PHONE,
        `🚨 ESCALATION needed!\nFrom: ${maskPhone(phone)}\nMessage: "${text.slice(0, 200)}"\nReply to this lead directly.`
      );
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
      }

      console.log(`New lead: ${maskPhone(phone)} market=${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existingClient && existingClient.status === 'active') {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    const program = matchProgram(text);
    if (program) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const market = existingLead.market;
      const programName = PROGRAM_NAMES[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (isHinglish(market)) {
        await sendText(phone,
          `Great choice! 🔥 ${programName} ke liye yeh raha checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhar do taaki hum tumhara plan customize kar sakein:\n${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `Great choice! 🔥 Here's the checkout link for ${programName}:\n${checkoutUrl}\n\nPlease also fill out this intake form so we can customise your plan:\n${intakeUrl}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
