const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone, detectMarket } = require('../lib/whatsapp');
const { classifyIntent, programLabel, jsonResponse } = require('../lib/utils');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.senderPhone || payload.from;
    const message = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const intent = classifyIntent(message);

    if (intent.type === 'optout') {
      if (existingLead) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
      }
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent.type === 'escalation') {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        maskPhone(phone),
        intent.keyword,
        message.slice(0, 200)
      ]);
      return res.status(200).json({ action: 'escalated', keyword: intent.keyword });
    }

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const isHinglish = market === 'IN';
      if (isHinglish) {
        await sendTemplate(phone, 'welcome_v1_hi', [
          senderName || 'there'
        ]);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [
          senderName || 'there'
        ]);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (intent.type === 'program_match') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent.program
      }).eq('id', existingLead.id);

      const label = programLabel(intent.program);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const isHinglish = market === 'IN';
      if (isHinglish) {
        await sendTemplate(phone, 'program_match_hi', [
          senderName || 'there',
          label,
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendTemplate(phone, 'program_match_en', [
          senderName || 'there',
          label,
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: intent.program });
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
