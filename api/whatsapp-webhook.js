const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getWelcomeMessage, getNudgeMessage } = require('../lib/market');
const { needsEscalation, escalate } = require('../lib/escalation');
const { classifyProgram, getCheckoutUrl } = require('../lib/classify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const text = extractText(payload);
    const name = extractName(payload);

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await escalate(phone, escalationKeyword, text);
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

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_no_reply' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(db, existingLead, text, res);
    }

    return res.json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(db, phone, name, text, res) {
  const market = detectMarket(phone);

  const { data: lead } = await db
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

  const welcomeMsg = getWelcomeMessage(market);
  await sendTemplate(phone, 'welcome_v1', [name || '']);

  scheduleNudge(phone, lead.id, market);

  return res.json({ action: 'new_lead', id: lead.id });
}

async function handleQualification(db, lead, text, res) {
  const match = classifyProgram(text);

  if (!match) {
    const msg = lead.market === 'IN'
      ? 'Koi baat nahi! Ye options mein se choose karo:\n\n1️⃣ Fat Loss / Shred\n2️⃣ PCOS Program\n3️⃣ 40+ Fitness\n4️⃣ 12-Week Custom\n5️⃣ $20 Zoom Trial'
      : "No worries! Choose from these options:\n\n1️⃣ Fat Loss / Shred\n2️⃣ PCOS Program\n3️⃣ 40+ Fitness\n4️⃣ 12-Week Custom\n5️⃣ $20 Zoom Trial";

    await sendText(lead.phone, msg);
    return res.json({ action: 'asked_to_clarify' });
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program,
    })
    .eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(match.checkoutSlug);
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msg = lead.market === 'IN'
    ? `${match.label} — best choice! 🔥\n\nCheckout: ${checkoutUrl}\n\nPayment ke baad ye form fill karo:\n${intakeUrl}`
    : `${match.label} — great choice! 🔥\n\nCheckout: ${checkoutUrl}\n\nAfter payment, fill this form:\n${intakeUrl}`;

  await sendText(lead.phone, msg);

  return res.json({ action: 'qualified', program: match.program });
}

function scheduleNudge(phone, leadId, market) {
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    const db = getSupabase();
    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (lead && lead.status === 'new') {
      await sendTemplate(phone, 'nudge_trial', []);
    }
  }, TWO_HOURS);

  setTimeout(async () => {
    const db = getSupabase();
    const { data: lead } = await db
      .from('leads')
      .select('status')
      .eq('id', leadId)
      .single();

    if (lead && lead.status === 'new') {
      await db.from('leads').update({ status: 'dropped' }).eq('id', leadId);
    }
  }, TWENTY_FOUR_HOURS);
}

function extractPhone(payload) {
  return (
    payload?.phone ||
    payload?.mobile ||
    payload?.from ||
    payload?.contact?.phone ||
    payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.wa_id ||
    null
  );
}

function extractText(payload) {
  return (
    payload?.text ||
    payload?.message ||
    payload?.body ||
    payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body ||
    ''
  );
}

function extractName(payload) {
  return (
    payload?.name ||
    payload?.contact?.name ||
    payload?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
    null
  );
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}
