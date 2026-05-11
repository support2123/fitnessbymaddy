const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const message = extractMessage(payload);
    const name = extractName(payload);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(message);
    if (esc.escalate) {
      await escalateToMaddy(phone, esc.keyword, message);
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const action = await handleNewLead(db, phone, name, message);
      return res.status(200).json(action);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const action = await handleQualification(db, existingLead, message);
      return res.status(200).json(action);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, message) {
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.substring(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (isHinglish(market)) {
    await sendWhatsApp(phone, 'welcome_v1', [
      name || 'there',
    ]);
  } else {
    await sendWhatsApp(phone, 'welcome_v1_en', [
      name || 'there',
    ]);
  }

  const matched = qualifyLead(message);
  if (matched) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: matched.program })
      .eq('id', lead.id);

    await sendWhatsApp(phone, 'program_offer', [
      matched.name,
      `$${matched.price}`,
      `https://fitnessbymaddyy.exlyapp.com/${matched.checkoutPath}`,
      `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
    ]);

    return { action: 'new_lead_qualified', program: matched.program };
  }

  return { action: 'new_lead_welcomed' };
}

async function handleQualification(db, lead, message) {
  const matched = qualifyLead(message);
  if (!matched) return { action: 'unqualified_reply' };

  await db
    .from('leads')
    .update({ status: 'qualified', program_interest: matched.program })
    .eq('id', lead.id);

  await sendWhatsApp(lead.phone, 'program_offer', [
    matched.name,
    `$${matched.price}`,
    `https://fitnessbymaddyy.exlyapp.com/${matched.checkoutPath}`,
    `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`,
  ]);

  return { action: 'qualified', program: matched.program };
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
  console.log(`Opt-out: ${maskPhone(phone)}`);
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.trim().toLowerCase();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function extractPhone(payload) {
  return payload?.phone || payload?.mobile || payload?.from || payload?.sender?.phone || null;
}

function extractMessage(payload) {
  return payload?.message || payload?.text || payload?.body || payload?.msg || null;
}

function extractName(payload) {
  return payload?.name || payload?.sender?.name || payload?.pushName || null;
}
