const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, maskPhone, notifyMaddy } = require('./_lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const OPT_OUT = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function classifyIntent(text) {
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const supabase = getSupabase();

  const payload = req.body;
  const phone = payload.phone || payload.from || payload.sender;
  const text = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: text.substring(0, 1000),
    template_name: null,
    status: 'received'
  });

  if (OPT_OUT.some(kw => text.toLowerCase().includes(kw))) {
    await supabase
      .from('leads')
      .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy(
      'Escalation needed',
      `Phone: ${maskPhone(phone)} | Message: ${text.substring(0, 150)}`
    );
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: lead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 500),
        market
      })
      .select()
      .single();

    const welcomeParams = isHinglish(market)
      ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
      : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?"];

    await sendTemplate(phone, 'welcome_v1', welcomeParams, false);

    return res.status(200).json({ action: 'new_lead', id: lead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
    .eq('id', existingLead.id);

  const program = classifyIntent(text);

  if (program && existingLead.status === 'new') {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const market = existingLead.market || 'GLOBAL';
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const PROGRAM_NAMES = {
      '6wk_gym': '6-Week Burn & Build',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      '12wk': '12-Week Custom Training',
      'zoom_trial': '$20 Zoom Trial'
    };

    const programName = PROGRAM_NAMES[program] || program;

    const params = isHinglish(market)
      ? [programName, checkoutUrl, intakeUrl]
      : [programName, checkoutUrl, intakeUrl];

    await sendTemplate(phone, 'program_qualified', params, false);

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
