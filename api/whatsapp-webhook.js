const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const {
  detectMarket,
  isHinglishMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  maskPhone,
  PROGRAM_NAMES,
  cors,
} = require('../lib/utils');

const MADDY_PHONE = '917082478374';
const SITE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body;

  const phone = payload.phone || payload.waId || payload.from;
  const text = payload.text || payload.message || payload.body || '';
  const senderName = payload.name || payload.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone in payload' });

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    status: 'received',
  });

  if (isOptOut(text)) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await sendTemplate(MADDY_PHONE, 'escalation_alert', [
      maskPhone(phone),
      text.slice(0, 200),
    ]);
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('id, program, status')
    .eq('phone', phone)
    .maybeSingle();

  if (existingClient) {
    return res.status(200).json({ action: 'existing_client', client_id: existingClient.id });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  const market = detectMarket(phone);

  if (!existingLead) {
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    const welcomeTemplate = isHinglishMarket(market) ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'dropped_lead_ignored' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = detectProgram(text);
  if (program) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const programName = PROGRAM_NAMES[program] || program;
    const checkoutLink = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeLink = `${SITE}/intake?lead=${existingLead.id}`;

    if (isHinglishMarket(market)) {
      await sendTemplate(phone, 'program_match_hi', [
        senderName || existingLead.name || 'there',
        programName,
        checkoutLink,
        intakeLink,
      ]);
    } else {
      await sendTemplate(phone, 'program_match_en', [
        senderName || existingLead.name || 'there',
        programName,
        checkoutLink,
        intakeLink,
      ]);
    }

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'reply_logged' });
};
