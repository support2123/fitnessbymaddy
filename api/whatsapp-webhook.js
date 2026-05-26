const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logInboundMessage, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('../lib/qualify');
const { ok, error } = require('../lib/response');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = normalizePhone(body.phone || body.from || body.senderPhone || '');
    const text = body.message || body.text || body.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    await logInboundMessage(phone, text);

    if (isOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', `Phone: ${phone}\nMessage: ${text}`);
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ ok: true, action: 'active_client_msg' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existingLead) {
      return res.status(200).json(await handleNewLead(phone, text));
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      return res.status(200).json(await handleQualification(existingLead.id, phone, text));
    }

    return res.status(200).json({ ok: true, action: 'existing_lead_msg' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let cleaned = raw.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = '+' + cleaned;
  return cleaned;
}

async function handleNewLead(phone, firstMsg) {
  const db = getSupabase();
  const market = detectMarket(phone);

  const { data: lead } = await db
    .from('leads')
    .insert({
      phone,
      first_msg: firstMsg,
      last_msg_at: new Date().toISOString(),
      market,
      status: 'new'
    })
    .select('id')
    .single();

  const isIndia = market === 'IN';
  const welcomeMsg = isIndia
    ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

  await sendWhatsApp(phone, [welcomeMsg], 'welcome_v1');

  scheduleNudges(phone, lead.id);

  return { ok: true, action: 'new_lead', leadId: lead.id };
}

async function handleQualification(leadId, phone, text) {
  const db = getSupabase();
  const match = qualifyLead(text);

  if (!match) {
    const market = detectMarket(phone);
    const fallback = market === 'IN'
      ? 'Koi baat nahi! Kya aap fat loss, PCOS, 40+ fitness, ya custom 12-week program mein interested hain? Ya $20 trial se start karein?'
      : 'No worries! Are you interested in fat loss, PCOS, 40+ fitness, or a custom 12-week program? Or start with a $20 trial?';
    await sendWhatsApp(phone, [fallback], 'qualify_retry');
    return { ok: true, action: 'qualify_retry' };
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: match.program,
    last_msg_at: new Date().toISOString()
  }).eq('id', leadId);

  const market = detectMarket(phone);
  const checkoutUrl = getCheckoutUrl(match.program);
  const intakeUrl = getIntakeUrl(leadId);

  const msg = market === 'IN'
    ? `Great choice! 🔥 ${match.label} aapke liye perfect hai.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nPayment ke baad hum aapka program turant start karenge!`
    : `Great choice! 🔥 ${match.label} is perfect for you.\n\n💳 Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nOnce you pay, we'll start your program right away!`;

  await sendWhatsApp(phone, [match.label, checkoutUrl, intakeUrl], 'qualified_checkout');

  return { ok: true, action: 'qualified', program: match.program };
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
  await db.from('clients').update({ status: 'paused' }).eq('phone', phone).eq('status', 'active');
}

function scheduleNudges(phone, leadId) {
  // Nudge at 2 hours — handled by a separate cron or delayed job
  // For now we store the lead creation time and the cron checks timing
}
