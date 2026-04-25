const { getSupabase } = require('./_lib/supabase');
const { detectMarket, isHinglish } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');
const { canSendToLead, sendTemplate, sendText, notifyMaddy, logMessage } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/mask-phone');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$45' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' }
];

const SITE = process.env.SITE_URL || 'https://www.fitnessbymaddy.com';
const EXLY_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp-webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.phone || payload.from || '');
    const text = (payload.message || payload.text || payload.body || '').trim();
    const senderName = payload.name || payload.sender_name || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logMessage(phone, 'in', text, null);

    if (checkOptOut(text)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.shouldEscalate) {
      await handleEscalation(phone, text, escalation.reason);
    }

    const sb = getSupabase();
    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await sb
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', note: 'Routed to support' });
    }

    if (!existingLead) {
      const action = await handleNewLead(phone, text, senderName);
      return res.status(200).json({ action });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead', note: 'No further messages' });
    }

    const action = await handleLeadReply(existingLead, text);
    return res.status(200).json({ action });

  } catch (err) {
    console.error(`[whatsapp-webhook] Error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, firstMsg, name) {
  const sb = getSupabase();
  const market = detectMarket(phone);

  await sb.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: firstMsg,
    last_msg_at: new Date().toISOString(),
    market
  });

  const hinglish = isHinglish(market);
  const welcomeParams = hinglish
    ? ["Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
    : ["Hi! Maddy's team here. What's your goal — fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial session first?"];

  await sendTemplate(phone, 'welcome_v1', {
    name: name || 'there',
    templateParams: welcomeParams
  });

  return 'new_lead_welcomed';
}

async function handleLeadReply(lead, text) {
  const sb = getSupabase();

  await sb.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const matched = matchProgram(text);
  if (!matched) {
    return 'no_program_match';
  }

  await sb.from('leads')
    .update({ status: 'qualified', program_interest: matched.program })
    .eq('id', lead.id);

  const hinglish = isHinglish(lead.market);
  const canSend = await canSendToLead(lead.phone);
  if (!canSend) {
    return 'rate_limited';
  }

  const checkoutUrl = `${EXLY_BASE}/${matched.program}`;
  const intakeUrl = `${SITE}/intake.html?lead=${lead.id}`;

  const msg = hinglish
    ? `Great choice! ${matched.label} (${matched.price}) perfect hai tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye intake form fill karo: ${intakeUrl}`
    : `Great choice! ${matched.label} (${matched.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill out the intake form first: ${intakeUrl}`;

  await sendText(lead.phone, msg);

  return `qualified_${matched.program}`;
}

async function handleOptOut(phone) {
  const sb = getSupabase();
  await sb.from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);
}

async function handleEscalation(phone, message, reason) {
  const sb = getSupabase();
  await sb.from('escalations').insert({
    phone,
    reason,
    context: message
  });
  await notifyMaddy(reason, { phone, message });
}

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

function normalizePhone(phone) {
  let p = phone.replace(/[^0-9+]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}
