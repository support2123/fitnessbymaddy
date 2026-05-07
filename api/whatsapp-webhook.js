const { supabase } = require('../lib/supabase');
const { sendTemplate, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior', 'knee'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Burn' },
];

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack',
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.mobile || payload.from || payload.senderMobile || '');
    const messageText = (payload.text || payload.message || payload.body || '').trim();

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logMessage(phone, 'in', messageText, null);

    if (isOptOut(messageText)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy('Sensitive keyword detected', phone, messageText.slice(0, 100));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      return await handleNewLead(phone, messageText, res);
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      return await handleQualification(existingLead, messageText, res);
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, messageText, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  const { data: lead } = await supabase
    .from('leads')
    .insert({
      phone,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageText,
      last_msg_at: new Date().toISOString(),
      market,
    })
    .select()
    .single();

  if (hinglish) {
    await sendTemplate(phone, 'welcome_v1', []);
  } else {
    await sendTemplate(phone, 'welcome_v1_en', []);
  }

  scheduleNudge(phone, lead.id);

  return res.status(200).json({ action: 'new_lead', leadId: lead.id });
}

async function handleQualification(lead, messageText, res) {
  const lower = messageText.toLowerCase();
  const hinglish = isHinglish(lead.market);
  let matched = null;

  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      matched = route;
      break;
    }
  }

  if (!matched) {
    matched = { program: 'zoom_trial', label: '$20 Zoom Trial' };
  }

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: matched.program,
    })
    .eq('id', lead.id);

  const checkoutUrl = CHECKOUT_LINKS[matched.program];
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const params = [matched.label, checkoutUrl, intakeUrl];
  const template = hinglish ? 'program_offer' : 'program_offer_en';
  await sendTemplate(lead.phone, template, params);

  return res.status(200).json({ action: 'qualified', program: matched.program });
}

function scheduleNudge(phone, leadId) {
  // Vercel cron handles nudges via /api/cron/nudge-dropped
  // The 2hr and 24hr nudge windows are checked there
}

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
