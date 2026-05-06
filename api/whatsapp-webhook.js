const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logIncoming } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { handleOptions, maskPhone } = require('../lib/utils');

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial' },
];

const CHECKOUT_MAP = {
  '6wk_gym': 'shred-6week',
  '6wk_home': 'shred-6week-home',
  'pcos': 'pcos-warrior',
  '40plus': '40plus-strong',
  '12wk': '12week-custom',
  'zoom_trial': 'zoom-trial',
  'zoom_pack': 'zoom-pack',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(k => lower.includes(k))) return route;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  return OPT_OUT_WORDS.some(w => lower === w || lower.includes(w));
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.phone || payload.from;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    await logIncoming(normalizedPhone, messageBody);

    if (isOptOut(messageBody)) {
      await handleOptOut(normalizedPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = needsEscalation(messageBody);
    if (escalation.escalate) {
      await notifyMaddy(normalizedPhone, escalation.reason, messageBody);
    }

    const supabase = getSupabase();
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .limit(1)
      .single();

    if (!existingLead) {
      await handleNewLead(supabase, normalizedPhone, senderName, messageBody);
      return res.status(200).json({ action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      await handleQualification(supabase, existingLead, messageBody);
      return res.status(200).json({ action: 'qualified' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(supabase, phone, name, firstMsg) {
  const market = detectMarket(phone);
  await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: firstMsg,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const greeting = market === 'IN'
    ? 'welcome_v1_hi'
    : 'welcome_v1_en';

  await sendTemplate(phone, greeting, [name || 'there']);
  console.log(`New lead: ${maskPhone(phone)} market=${market}`);
}

async function handleQualification(supabase, lead, messageBody) {
  const route = matchProgram(messageBody);

  if (!route) {
    const followUp = lead.market === 'IN'
      ? 'followup_options_hi'
      : 'followup_options_en';
    await sendTemplate(lead.phone, followUp, [lead.name || 'there']);
    return;
  }

  const checkoutSlug = CHECKOUT_MAP[route.program] || route.program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${checkoutSlug}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  await supabase
    .from('leads')
    .update({
      status: 'qualified',
      program_interest: route.program,
      last_msg_at: new Date().toISOString(),
    })
    .eq('id', lead.id);

  const templateName = lead.market === 'IN'
    ? 'program_offer_hi'
    : 'program_offer_en';

  await sendTemplate(lead.phone, templateName, [
    lead.name || 'there',
    route.label,
    checkoutUrl,
    intakeUrl,
  ]);

  console.log(`Lead qualified: ${maskPhone(lead.phone)} → ${route.program}`);
}

async function handleOptOut(phone) {
  const supabase = getSupabase();
  await supabase
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await supabase
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');

  console.log(`Opt-out: ${maskPhone(phone)}`);
}
