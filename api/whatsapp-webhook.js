const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, getProgramName, jsonResponse, errorResponse } = require('./_lib/helpers');
const { escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        clientName: name,
        details: text.slice(0, 200)
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, text, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleLeadQualification(db, existingLead, text, res);
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const isHinglish = market === 'IN';
  const welcomeTemplate = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  const welcomeBody = isHinglish
    ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a $20 trial first?";

  await sendWhatsApp({
    phone,
    templateName: welcomeTemplate,
    body: welcomeBody,
    params: [name || 'there']
  });

  const program = detectProgram(text);
  if (program) {
    return await handleLeadQualification(db, lead, text, res);
  }

  return res.status(200).json({ action: 'new_lead_welcomed', lead_id: lead.id });
}

async function handleLeadQualification(db, lead, text, res) {
  const program = detectProgram(text);

  if (!program) {
    return res.status(200).json({ action: 'reply_logged_no_match' });
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const market = lead.market || detectMarket(lead.phone);
  const isHinglish = market === 'IN';
  const programName = getProgramName(program);

  const checkoutMsg = isHinglish
    ? `Great choice! ${programName} ke liye yeh raha checkout link. Intake form bhi fill karo taaki hum tumhara plan customize kar sakein.`
    : `Great choice! Here's the checkout link for ${programName}. Also fill out the intake form so we can customize your plan.`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'program_checkout',
    body: checkoutMsg,
    params: [programName]
  });

  return res.status(200).json({
    action: 'lead_qualified',
    program,
    lead_id: lead.id
  });
}
