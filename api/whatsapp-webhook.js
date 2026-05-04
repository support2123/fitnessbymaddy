const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'fat': '6wk_gym', 'lose': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk',
  'flagship': '12wk', 'personalised': '12wk', 'personalized': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial',
  'try': 'zoom_trial', 'home': '6wk_home'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

function routeToProgram(text) {
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.from || payload.sender;
  const text = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.pushName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number' });
  }

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  if (/\b(stop|unsubscribe)\b/i.test(text)) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalate(phone, `Message contains sensitive keyword: "${text.slice(0, 50)}"`);
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({ action: 'new_lead_greeted' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  const program = routeToProgram(text);
  if (program && existingLead.status === 'new') {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('phone', phone);

    const market = existingLead.market || detectMarket(phone);
    const checkoutLink = CHECKOUT_LINKS[program];
    const programName = PROGRAM_NAMES[program];
    const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    const template = market === 'IN' ? 'program_offer_hindi' : 'program_offer';
    await sendTemplate(phone, template, {
      name: existingLead.name || 'there',
      templateParams: [programName, checkoutLink, intakeLink]
    });

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
