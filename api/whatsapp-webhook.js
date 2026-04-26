const { supabase } = require('../lib/supabase');
const { sendTemplate, sendSession, notifyMaddy, logMessage, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, isOptOut, getEscalationReason } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: '$20 Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' }
];

const CHECKOUT_BASE = 'https://fitnessbymaddyy.exlyapp.com/checkout';
const SITE_BASE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.phone || body.mobile || body.from || body.senderPhone || '');
    const name = body.name || body.senderName || body.pushName || null;
    const message = (body.message || body.text || body.body || '').trim();

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await handleEscalation(phone, name, message);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', note: 'forwarded to support' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      await handleNewLead(phone, name, message);
      return res.status(200).json({ action: 'new_lead_created' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', note: 'no action' });
    }

    await handleLeadReply(existingLead, message);
    return res.status(200).json({ action: 'lead_qualified' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, name, message) {
  const market = detectMarket(phone);

  await supabase.from('leads').insert({
    phone,
    name,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.slice(0, 500),
    last_msg_at: new Date().toISOString(),
    market
  });

  if (isHinglish(market)) {
    await sendTemplate(phone, 'welcome_v1', [name || 'there']);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
  }

  const matched = matchProgram(message);
  if (matched) {
    await routeToProgram(phone, matched, market);
  }
}

async function handleLeadReply(lead, message) {
  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const matched = matchProgram(message);
  if (matched) {
    await supabase.from('leads')
      .update({ status: 'qualified', program_interest: matched.program })
      .eq('id', lead.id);

    await routeToProgram(lead.phone, matched, lead.market);
  }
}

async function routeToProgram(phone, match, market) {
  const allowed = await canSendMessage(phone);
  if (!allowed) return;

  const hinglish = isHinglish(market);
  const checkoutUrl = `${CHECKOUT_BASE}/${match.program}`;

  const { data: lead } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  const intakeUrl = lead
    ? `${SITE_BASE}/intake?lead=${lead.id}`
    : `${SITE_BASE}/intake`;

  let msg;
  if (hinglish) {
    msg = `Perfect choice! *${match.label}* aapke liye ready hai.\n\n` +
      `Checkout: ${checkoutUrl}\n\n` +
      `Payment ke baad ye form bhi fill karo taaki hum aapka plan customise kar sakein:\n${intakeUrl}`;
  } else {
    msg = `Great choice! *${match.label}* is perfect for your goals.\n\n` +
      `Checkout here: ${checkoutUrl}\n\n` +
      `After payment, fill out this form so we can customise your plan:\n${intakeUrl}`;
  }

  await sendSession(phone, msg);
}

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

async function handleOptOut(phone) {
  await supabase.from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase.from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}

async function handleEscalation(phone, name, message) {
  const reason = getEscalationReason(message);
  await notifyMaddy(
    'Lead needs human review',
    `Phone: ${maskPhone(phone)}\nName: ${name || 'Unknown'}\nReason: ${reason}\nMessage: "${message.slice(0, 200)}"`
  );
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
