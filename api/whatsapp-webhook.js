const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  fortyplus: { keywords: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', name: '40+ Strong' },
  flagship: { keywords: ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' }
};

const CHECKOUT_MAP = {
  '6wk_gym': 'shred-6wk',
  'pcos': 'pcos-warrior',
  '40plus': '40plus-strong',
  '12wk': 'custom-12wk',
  'zoom_trial': 'zoom-trial'
};

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return { key, ...route };
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({ reason: 'keyword_trigger', phone, clientName: name, message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead({ phone, message, name, market, hinglish, res });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new') {
      return await handleQualification({ lead: existingLead, message, hinglish, res });
    }

    return res.json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.message && body.phone) return body;
  if (body.data) {
    return {
      phone: body.data.phone || body.data.from,
      message: body.data.message || body.data.text || body.data.body,
      name: body.data.name || body.data.pushName
    };
  }
  return {
    phone: body.from || body.phone || body.sender,
    message: body.text || body.body || body.message,
    name: body.pushName || body.name
  };
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'optout'].includes(lower);
}

async function handleOptOut(phone) {
  await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
}

async function handleNewLead({ phone, message, name, market, hinglish, res }) {
  await supabase.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: message, last_msg_at: new Date().toISOString(), market
  });

  const welcomeParams = hinglish
    ? ['Hi! Maddy ki team yahan 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
    : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS, strength, or 40+ fitness? Or try a trial session first?"];

  await sendWhatsApp({
    phone,
    templateName: 'welcome_v1',
    body: welcomeParams[0],
    params: welcomeParams
  });

  return res.json({ action: 'new_lead_welcomed', market });
}

async function handleQualification({ lead, message, hinglish, res }) {
  const match = matchProgram(message);
  if (!match) {
    return res.json({ action: 'no_program_match', lead_id: lead.id });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: match.program
  }).eq('id', lead.id);

  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${CHECKOUT_MAP[match.program]}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  const qualifyMsg = hinglish
    ? `Great choice! 🔥 ${match.name} program aapke liye perfect hai.\n\nPayment link: ${checkoutUrl}\n\nSaath mein ye intake form bhi fill karo: ${intakeUrl}`
    : `Great choice! 🔥 The ${match.name} program is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nAlso fill out this intake form: ${intakeUrl}`;

  await sendWhatsApp({
    phone: lead.phone,
    templateName: 'qualify_program',
    body: qualifyMsg,
    params: [match.name, checkoutUrl, intakeUrl]
  });

  return res.json({ action: 'qualified', program: match.program });
}
