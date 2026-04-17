const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, detectProgram, isEscalationTrigger, isOptOut, PROGRAM_DETAILS, jsonResponse } = require('./lib/utils');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = extractPhone(body);
    const message = extractMessage(body);
    const name = extractName(body);

    if (!phone || !message) {
      return res.status(200).json({ ok: true, skipped: 'no phone or message' });
    }

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message.substring(0, 1000),
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (isEscalationTrigger(message)) {
      await escalateToMaddy('Message flagged for review', { phone, message });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, name, message, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, skipped: 'lead opted out' });
    }

    return await handleExistingLead(db, existingLead, message, res);
  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);

  const { data: lead, error } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.substring(0, 500),
      last_msg_at: new Date().toISOString(),
      program_interest: detectProgram(message),
      market,
    })
    .select()
    .single();

  if (error) {
    console.error('[whatsapp-webhook] Insert lead error:', error.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  const isHinglish = market === 'IN';
  if (isHinglish) {
    await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendWhatsApp(phone, 'welcome_v1_en', [name || 'there']);
  }

  const program = detectProgram(message);
  if (program) {
    await routeToProgram(db, lead, program, phone, market);
  }

  return res.status(200).json({ ok: true, action: 'new_lead', lead_id: lead.id });
}

async function handleExistingLead(db, lead, message, res) {
  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const program = detectProgram(message);
  if (program && lead.status === 'new') {
    await routeToProgram(db, lead, program, lead.phone, lead.market);
    return res.status(200).json({ ok: true, action: 'qualified', program });
  }

  return res.status(200).json({ ok: true, action: 'message_logged' });
}

async function routeToProgram(db, lead, program, phone, market) {
  const details = PROGRAM_DETAILS[program];
  if (!details) return;

  await db
    .from('leads')
    .update({ status: 'qualified', program_interest: program })
    .eq('id', lead.id);

  const isHinglish = market === 'IN';
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const params = [
    details.name,
    `$${details.price}`,
    checkoutUrl,
    intakeUrl,
  ];

  const template = isHinglish ? 'program_offer' : 'program_offer_en';
  await sendWhatsApp(phone, template, params);
}

function extractPhone(body) {
  if (body?.mobile) return body.mobile;
  if (body?.payload?.sender?.phone) return body.payload.sender.phone;
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return body.entry[0].changes[0].value.messages[0].from;
  }
  if (body?.phone) return body.phone;
  return null;
}

function extractMessage(body) {
  if (body?.message) return body.message;
  if (body?.payload?.payload?.text) return body.payload.payload.text;
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return body.entry[0].changes[0].value.messages[0].text.body;
  }
  if (body?.text) return body.text;
  return null;
}

function extractName(body) {
  if (body?.name) return body.name;
  if (body?.payload?.sender?.name) return body.payload.sender.name;
  if (body?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return body.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}
