const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logIncoming } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, escalate } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl } = require('./lib/qualify');
const { maskPhone } = require('./lib/mask');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderPhone || '');
    const body = (payload.text || payload.message || payload.body || '').trim();
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming({ phone, body });

    if (isOptOut(body)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(body);
    if (escalationKeyword) {
      await escalate({ phone, reason: escalationKeyword, messageBody: body });
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead({ phone, body, name, db, res });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString(), first_msg: existingLead.first_msg || body })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification({ lead: existingLead, body, db, res });
    }

    return res.json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead({ phone, body, name, db, res }) {
  const market = detectMarket(phone);

  const { data: lead } = await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: body,
    market
  }).select().single();

  const hinglish = isHinglish(market);

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: hinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?",
    params: [name || 'there']
  });

  scheduleNudge(phone, lead.id, hinglish);

  return res.json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification({ lead, body, db, res }) {
  const match = qualifyLead(body);

  if (!match) {
    const hinglish = isHinglish(lead.market);
    await sendWhatsApp({
      phone: lead.phone,
      body: hinglish
        ? "Got it! Thoda aur batao — fat loss chahiye, PCOS help, 40+ fitness, ya 12-week custom program? Ya pehle ek trial Zoom session ($20) try karo?"
        : "Got it! Could you tell me more — looking for fat loss, PCOS help, 40+ fitness, or a full 12-week custom program? Or try a $20 trial Zoom session first?"
    });
    return res.json({ action: 'qualification_retry' });
  }

  await db.from('leads')
    .update({
      status: 'qualified',
      program_interest: match.program
    })
    .eq('id', lead.id);

  const checkoutUrl = getCheckoutUrl(match.program);
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;
  const hinglish = isHinglish(lead.market);

  await sendWhatsApp({
    phone: lead.phone,
    body: hinglish
      ? `Perfect choice! 🔥 ${match.label} program ke liye yeh raha link:\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake Form: ${intakeUrl}\n\nForm bhar do toh Maddy tera plan bana sakti hai!`
      : `Perfect choice! 🔥 Here's your link for the ${match.label}:\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake Form: ${intakeUrl}\n\nFill out the intake form so Maddy can build your plan!`
  });

  return res.json({ action: 'qualified', program: match.program });
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

function isOptOut(body) {
  if (!body) return false;
  const lower = body.toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out' || lower === 'optout';
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

function scheduleNudge(phone, leadId, hinglish) {
  // Nudges are handled by the cron/nudge-dropped endpoint
  // which checks leads that haven't replied within time windows
}
