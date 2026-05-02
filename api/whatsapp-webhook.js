const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'weight', 'burn', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'over 40', '40+'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function classifyIntent(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.from || payload.sender;
  const message = payload.message || payload.text || payload.body || '';
  const name = payload.name || payload.pushName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number' });
  }

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  const lower = (message || '').toLowerCase();
  if (lower.includes('stop') || lower.includes('unsubscribe')) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy('Keyword trigger in message', { phone, message });
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const greeting = market === 'IN'
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);
    return res.status(200).json({ action: 'new_lead_greeted' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  const program = classifyIntent(message);
  if (program) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const market = existingLead.market || detectMarket(phone);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const programNames = {
      '6wk_gym': '6-Week Burn & Build',
      'pcos': 'PCOS Warrior Program',
      '40plus': '40+ Strong Program',
      '12wk': '12-Week Custom Flagship',
      'zoom_trial': '$20 Zoom Trial Session'
    };

    await sendWhatsApp(phone, 'program_offer', [
      name || 'there',
      programNames[program] || program,
      checkoutUrl
    ]);

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
