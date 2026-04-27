const { getSupabase } = require('../lib/supabase');
const { rateLimitedSend, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, getEscalationReason } = require('../lib/escalation');
const { routeToProgram } = require('../lib/program-router');
const { maskPhone } = require('../lib/mask-phone');

const SITE = 'https://www.fitnessbymaddy.com';
const EXLY_CHECKOUT = 'https://fitnessbymaddyy.exlyapp.com/checkout';

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);
    if (!message) {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const { phone, text, name } = message;
    const db = getSupabase();

    await logMessage(phone, 'in', text, null, 'received');

    if (isOptOut(text)) {
      await handleOptOut(db, phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const reasons = getEscalationReason(text);
      await notifyMaddy(
        'Escalation needed',
        `${maskPhone(phone)} mentioned: ${reasons.join(', ')}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await handleNewLead(db, phone, text, name);
    } else if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    } else if (existingLead.status === 'new') {
      await handleLeadReply(db, existingLead, text);
    } else {
      await db
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, error: 'processed_with_error' });
  }
};

function extractMessage(payload) {
  if (payload.phone && payload.text) {
    return {
      phone: normalizePhone(payload.phone),
      text: payload.text,
      name: payload.name || null
    };
  }

  if (payload.entry) {
    const changes = payload.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    if (!msg) return null;
    const contact = changes?.contacts?.[0];
    return {
      phone: normalizePhone(msg.from),
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  return null;
}

function normalizePhone(phone) {
  let clean = phone.replace(/[^0-9]/g, '');
  if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

async function handleNewLead(db, phone, text, name) {
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    last_msg_at: new Date().toISOString(),
    market
  });

  const welcomeParams = isHinglish(market)
    ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial session first?'];

  await rateLimitedSend(phone, 'welcome_v1', welcomeParams);
}

async function handleLeadReply(db, lead, text) {
  const route = routeToProgram(text);

  if (!route) {
    const market = lead.market || 'GLOBAL';
    const msg = isHinglish(market)
      ? ['Kya aap fat loss, PCOS, 40+ fitness, ya 12-week custom program mein interested ho? Ya $20 trial try karna hai?']
      : ['Are you interested in fat loss, PCOS support, 40+ fitness, or our 12-week custom program? Or try a $20 trial session?'];
    await rateLimitedSend(lead.phone, 'clarify_goal', msg);
    return;
  }

  await db
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: route.program,
      last_msg_at: new Date().toISOString()
    })
    .eq('id', lead.id);

  const checkoutUrl = `${EXLY_CHECKOUT}/${route.checkout}`;
  const intakeUrl = `${SITE}/intake.html?lead=${lead.id}`;
  const market = lead.market || 'GLOBAL';

  const msg = isHinglish(market)
    ? [route.name, `$${route.price}`, checkoutUrl, intakeUrl]
    : [route.name, `$${route.price}`, checkoutUrl, intakeUrl];

  await rateLimitedSend(lead.phone, 'program_offer', msg);
}

async function handleOptOut(db, phone) {
  await db
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}
