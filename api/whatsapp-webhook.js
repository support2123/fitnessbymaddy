const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getLanguage } = require('../lib/market');
const { shouldEscalate, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();
  const body = req.body;

  const phone = body.mobile || body.from || body.sender;
  const message = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  // Log incoming message
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: message.slice(0, 2000),
    sent_at: new Date().toISOString()
  });

  // Check opt-out
  const lowerMsg = message.toLowerCase().trim();
  if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Check escalation
  if (shouldEscalate(message)) {
    await notifyMaddy('Keyword trigger in message', { name, phone, message });
    return res.status(200).json({ action: 'escalated' });
  }

  // Check if existing lead
  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    // New lead — Flow A
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const lang = getLanguage(market);
    const template = lang === 'hinglish' ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, template, { name: name || 'there', templateParams: [name || 'there'] });

    await supabase.from('messages').insert({
      phone,
      direction: 'out',
      body: 'Welcome template sent',
      template_name: template,
      sent_at: new Date().toISOString(),
      status: 'sent'
    });

    return res.status(200).json({ action: 'new_lead_welcomed', market });
  }

  // Existing lead — Flow B: qualify
  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    let matchedProgram = null;
    for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
      if (lowerMsg.includes(keyword)) {
        matchedProgram = program;
        break;
      }
    }

    if (matchedProgram) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram
      }).eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_LINKS[matchedProgram];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const market = existingLead.market || detectMarket(phone);
      const lang = getLanguage(market);
      const template = lang === 'hinglish' ? 'program_link_hi' : 'program_link_en';

      await sendWhatsApp(phone, template, {
        name: existingLead.name || 'there',
        templateParams: [existingLead.name || 'there', checkoutUrl, intakeUrl]
      });

      await supabase.from('messages').insert({
        phone,
        direction: 'out',
        body: `Sent ${matchedProgram} checkout + intake links`,
        template_name: template,
        sent_at: new Date().toISOString(),
        status: 'sent'
      });

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }
  }

  // Check if active client
  const { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (client) {
    // Active client message — log and potentially escalate
    if (shouldEscalate(message)) {
      await notifyMaddy('Active client concern', { name: client.name, phone, message });
    }
    return res.status(200).json({ action: 'client_message_logged' });
  }

  return res.status(200).json({ action: 'message_logged' });
};
