const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy, canSend } = require('./_lib/whatsapp');
const {
  detectMarket, isHinglish, needsEscalation, isOptOut,
  classifyIntent, PROGRAM_NAMES, maskPhone, corsHeaders
} = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const payload = req.body;

  const phone = payload?.waId || payload?.senderPhone || payload?.from;
  const text = payload?.text || payload?.body || payload?.message?.text || '';
  const senderName = payload?.senderName || payload?.pushName || null;

  if (!phone) {
    return res.status(400).json({ error: 'missing phone' });
  }

  console.log(`[WA-IN] ${maskPhone(phone)}: ${text.slice(0, 60)}`);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy('Keyword trigger', `From: ${maskPhone(phone)}\nMsg: ${text.slice(0, 200)}`);
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there']);
    }

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    return res.status(200).json({ action: 'active_client_msg_logged' });
  }

  const intent = classifyIntent(text);
  if (intent) {
    await db.from('leads').update({
      program_interest: intent,
      status: 'qualified'
    }).eq('id', existingLead.id);

    const programName = PROGRAM_NAMES[intent];
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const allowed = await canSend(phone, false);
    if (allowed) {
      if (isHinglish(existingLead.market)) {
        await sendTemplate(phone, 'program_offer', [
          senderName || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendTemplate(phone, 'program_offer_en', [
          senderName || existingLead.name || 'there',
          programName,
          checkoutUrl,
          intakeUrl
        ]);
      }
    }

    return res.status(200).json({ action: 'qualified', program: intent });
  }

  return res.status(200).json({ action: 'msg_logged' });
};
