const { supabase } = require('./_lib/supabase');
const { sendTemplate, canSendToLead, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket, isHinglishMarket, detectProgram, needsEscalation,
  isOptOut, maskPhone, jsonResponse, errorResponse, PROGRAM_NAMES,
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp-webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload?.waId || payload?.from || payload?.senderPhone || '';
    const text = payload?.text || payload?.body || payload?.message || '';
    const senderName = payload?.senderName || payload?.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Sensitive message from lead',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, text, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'already_converted' });
    }

    return await handleReturningLead(existingLead, text, res);
  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, text, name, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglishMarket(market);

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (error) {
    console.error('[WA] Lead insert error:', error.message);
    return res.status(500).json({ error: 'DB error' });
  }

  const program = detectProgram(text);
  if (program) {
    return await qualifyLead(lead, program, hinglish, res);
  }

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleReturningLead(lead, text, res) {
  const market = lead.market || detectMarket(lead.phone);
  const hinglish = isHinglishMarket(market);

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = detectProgram(text);
  if (program) {
    return await qualifyLead(lead, program, hinglish, res);
  }

  return res.status(200).json({ action: 'message_logged', lead_id: lead.id });
}

async function qualifyLead(lead, program, hinglish, res) {
  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const canSend = await canSendToLead(lead.phone);
  if (canSend) {
    await sendTemplate(lead.phone, 'program_recommendation', [
      lead.name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return res.status(200).json({
    action: 'lead_qualified',
    lead_id: lead.id,
    program,
  });
}
