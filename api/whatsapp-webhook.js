const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut } = require('../lib/escalation');
const { matchProgram } = require('../lib/keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null, 'received');

    if (isOptOut(text)) {
      await handleOptOut(db, phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(
        `Escalation from ${maskPhone(phone)}`,
        `Trigger: "${esc.trigger}"\nMessage: "${text}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', note: 'Routed to support' });
    }

    if (!existingLead) {
      await handleNewLead(db, phone, name, text);
      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      await handleQualification(db, existingLead, text);
      return res.status(200).json({ action: 'qualified' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text) {
  const market = detectMarket(phone);
  const matched = matchProgram(text);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    program_interest: matched?.key || null,
    market,
    created_at: new Date().toISOString()
  }).select().single();

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [
      name || 'there'
    ], false);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [
      name || 'there'
    ], false);
  }

  if (matched) {
    await qualifyAndRoute(db, lead, matched, market);
  }
}

async function handleQualification(db, lead, text) {
  const matched = matchProgram(text);
  if (!matched) return;

  await qualifyAndRoute(db, lead, matched, lead.market);
}

async function qualifyAndRoute(db, lead, matched, market) {
  await db.from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.key,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.key}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const hinglish = isHinglish(market);
  const msg = hinglish
    ? `Great choice! 🎯 "${matched.name}" — ₹${matched.price * 83} mein.\n\n👉 Checkout: ${checkoutUrl}\n📝 Intake form bhi fill karo: ${intakeUrl}`
    : `Great choice! 🎯 "${matched.name}" — $${matched.price}.\n\n👉 Checkout: ${checkoutUrl}\n📝 Fill intake form: ${intakeUrl}`;

  await sendText(lead.phone, msg);
}

async function handleOptOut(db, phone) {
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
}

function normalizePhone(payload) {
  return payload?.phone || payload?.mobile || payload?.from ||
    payload?.sender?.phone || payload?.contact?.phone ||
    payload?.waId || null;
}

function extractText(payload) {
  return payload?.text || payload?.message?.text || payload?.body ||
    payload?.message?.body || payload?.content || '';
}

function extractName(payload) {
  return payload?.name || payload?.sender?.name || payload?.contact?.name ||
    payload?.profileName || null;
}
