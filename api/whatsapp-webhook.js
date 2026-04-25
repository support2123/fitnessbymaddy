const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { qualifyLead } = require('../lib/qualify');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const message = extractMessage(payload);
    const senderName = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', message, null, 'received');

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, name: senderName, message });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(db, phone, message, senderName, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, message, res);
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'updated' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, message, name, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  }).select().single();

  const hinglish = isHinglish(market);

  const welcomeParams = hinglish
    ? [name || 'there']
    : [name || 'there'];

  await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

  const match = qualifyLead(message);
  if (match) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: match.program,
    }).eq('id', lead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

    const qualifyParams = hinglish
      ? [match.label, `$${match.price}`, checkoutUrl]
      : [match.label, `$${match.price}`, checkoutUrl];

    await sendWhatsApp(phone, 'program_match', qualifyParams);

    return res.status(200).json({ action: 'new_lead_qualified', program: match.program });
  }

  return res.status(200).json({ action: 'new_lead_created', leadId: lead.id });
}

async function handleQualification(db, lead, message, res) {
  const match = qualifyLead(message);
  if (!match) {
    return res.status(200).json({ action: 'no_match', leadId: lead.id });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;

  await sendWhatsApp(lead.phone, 'program_match', [
    match.label,
    `$${match.price}`,
    checkoutUrl,
  ]);

  return res.status(200).json({ action: 'qualified', program: match.program });
}

function extractPhone(payload) {
  if (payload?.phone) return payload.phone;
  if (payload?.waId) return '+' + payload.waId;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id) {
    return '+' + payload.entry[0].changes[0].value.contacts[0].wa_id;
  }
  if (payload?.sender?.phone) return payload.sender.phone;
  return null;
}

function extractMessage(payload) {
  if (payload?.message) return payload.message;
  if (payload?.text?.body) return payload.text.body;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload?.body) return payload.body;
  return '';
}

function extractName(payload) {
  if (payload?.name) return payload.name;
  if (payload?.sender?.name) return payload.sender.name;
  if (payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}
