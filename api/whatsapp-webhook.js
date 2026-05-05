const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight', 'shred', 'burn', 'lose'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();

  if (lower.includes('stop') || lower.includes('unsubscribe')) {
    return 'opt_out';
  }

  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      return program;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const { phone, message, name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  // Audit inbound message
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: message || '',
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  // Check opt-out
  const intent = classifyIntent(message);
  if (intent === 'opt_out') {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Escalation check
  if (needsEscalation(message)) {
    await escalateToMaddy({
      reason: 'Keyword trigger in message',
      phone: maskPhone(phone),
      context: (message || '').slice(0, 100),
    });
  }

  // Check if existing lead
  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!existingLead) {
    // New lead - FLOW A
    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message || '',
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    // Send welcome message
    const welcomeParams = market === 'IN'
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      params: welcomeParams,
    });

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  // Existing lead - FLOW B (qualification)
  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (intent && intent !== 'opt_out') {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: intent })
      .eq('id', existingLead.id);

    const market = existingLead.market || 'GLOBAL';
    const programNames = {
      '6wk_gym': '6-Week Burn & Build',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      '12wk': '12-Week Custom Flagship',
      'zoom_trial': '$20 Zoom Trial Session',
    };

    const checkoutLinks = {
      '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
      'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
      '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
      '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
      'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    };

    const programName = programNames[intent] || intent;
    const checkoutLink = checkoutLinks[intent] || '';
    const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    const msgParams = market === 'IN'
      ? [`${programName} aapke liye perfect hai! 🔥\n\nCheckout: ${checkoutLink}\n\nIntake form bhi fill kardo: ${intakeLink}`]
      : [`${programName} is perfect for your goals! 🔥\n\nCheckout: ${checkoutLink}\n\nAlso fill out your intake form: ${intakeLink}`];

    await sendWhatsApp({
      phone,
      templateName: 'program_recommendation',
      params: msgParams,
    });

    return res.status(200).json({ action: 'qualified', program: intent });
  }

  return res.status(200).json({ action: 'message_logged' });
};
