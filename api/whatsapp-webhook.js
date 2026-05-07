const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, escalate } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const db = getSupabase();
    await logIncomingMessage(phone, message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opt_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      await escalate(phone, escalationReason, message);
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
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.waId) return { phone: body.waId, message: body.text, name: body.pushName };
  if (body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name
    };
  }
  return { phone: body.phone, message: body.message || body.text, name: body.name };
}

function isOptOut(message) {
  const lower = (message || '').toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

async function handleNewLead(db, phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market
  }).select().single();

  const welcomeMsg = hinglish
    ? `Hi${name ? ' ' + name : ''}! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
    : `Hi${name ? ' ' + name : ''}! Welcome to Fitness by Maddy 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

  await sendWhatsApp({ phone, templateName: 'welcome_v1', body: welcomeMsg });

  const qualification = qualifyLead(message);
  if (qualification) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: qualification.program
    }).eq('id', lead.id);

    const checkoutUrl = getCheckoutUrl(qualification.program);
    const intakeUrl = getIntakeUrl(lead.id);
    const qualMsg = hinglish
      ? `Great choice! 🔥 ${qualification.label} program perfect rahega tere liye.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}`
      : `Great choice! 🔥 The ${qualification.label} program is perfect for you.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}`;

    await sendWhatsApp({ phone, body: qualMsg });
    return res.status(200).json({ action: 'new_lead_qualified', program: qualification.program });
  }

  return res.status(200).json({ action: 'new_lead_created', leadId: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const qualification = qualifyLead(message);
  if (!qualification) {
    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
    return res.status(200).json({ action: 'awaiting_qualification' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: qualification.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const checkoutUrl = getCheckoutUrl(qualification.program);
  const intakeUrl = getIntakeUrl(lead.id);

  const msg = hinglish
    ? `Perfect! 🔥 ${qualification.label} tere liye best rahega.\n\n💳 Book karo: ${checkoutUrl}\n📋 Form bharo: ${intakeUrl}\n\nKoi question ho toh pooch!`
    : `Perfect! 🔥 The ${qualification.label} is ideal for you.\n\n💳 Book here: ${checkoutUrl}\n📋 Fill your intake form: ${intakeUrl}\n\nAny questions? Just ask!`;

  await sendWhatsApp({ phone: lead.phone, body: msg });
  return res.status(200).json({ action: 'lead_qualified', program: qualification.program });
}
