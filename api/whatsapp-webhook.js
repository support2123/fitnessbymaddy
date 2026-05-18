const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, matchProgram, needsEscalation, isOptOut, maskPhone, json, PROGRAM_INFO } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return json(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();

  try {
    const { mobile: phone, message, name } = req.body;

    if (!phone || !message) {
      return json(res, { error: 'Missing phone or message' }, 400);
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    if (isOptOut(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return json(res, { action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      await escalateToMaddy(
        phone,
        'Flagged keyword in message',
        message,
        client?.id
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, name, res);
    }

    if (existingLead.status === 'dropped') {
      return json(res, { action: 'ignored_dropped_lead' });
    }

    return await handleReturningLead(db, existingLead, message, res);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    })
    .select()
    .single();

  const templateName = market === 'IN' ? 'welcome_v1_hinglish' : 'welcome_v1';
  await sendWhatsApp(phone, templateName, {
    name: name || 'there',
    templateParams: [name || 'there'],
    body: "Hi! Maddy's team here. What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial first?"
  });

  const program = matchProgram(message);
  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', lead.id);

    await sendProgramLink(phone, program, lead.id, market);
  }

  return json(res, { action: 'new_lead', lead_id: lead.id, program });
}

async function handleReturningLead(db, lead, message, res) {
  await db.from('leads').update({
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const program = matchProgram(message);
  if (program && lead.status === 'new') {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', lead.id);

    await sendProgramLink(lead.phone, program, lead.id, lead.market);
    return json(res, { action: 'qualified', program });
  }

  return json(res, { action: 'message_logged' });
}

async function sendProgramLink(phone, program, leadId, market) {
  const info = PROGRAM_INFO[program];
  if (!info) return;

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  const msg = market === 'IN'
    ? `${info.name} — perfect choice! Price: $${info.price}. Checkout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
    : `${info.name} — great choice! Price: $${info.price}. Checkout: ${checkoutUrl}\n\nPlease fill the intake form: ${intakeUrl}`;

  await sendWhatsApp(phone, 'program_link', {
    templateParams: [info.name, String(info.price), checkoutUrl, intakeUrl],
    body: msg
  });
}
