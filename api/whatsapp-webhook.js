const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage, canSendToLead } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, checkOptOut, escalateToMaddy, handleOptOut } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period', 'pcod'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', 'over 40', '40+', '50+'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'full program', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
};

const PROGRAM_CHECKOUT = {
  '6wk_gym': { name: '6-Week Burn & Build', price: '$97' },
  'pcos': { name: 'PCOS Warrior', price: '$45' },
  '40plus': { name: '40+ Strong', price: '$50' },
  '12wk': { name: '12-Week Flagship', price: '$200' },
  'zoom_trial': { name: 'Zoom Trial', price: '$20' },
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender?.phone;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const sb = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = checkEscalation(message);
    if (escalationTrigger) {
      const { data: client } = await sb
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .maybeSingle();

      await escalateToMaddy(phone, escalationTrigger, message, client?.id);
    }

    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const { data: activeClient } = await sb
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (activeClient) {
      await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    if (!existingLead) {
      await sb.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message?.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      });

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: hinglish
          ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
          : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'],
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await sb.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existingLead.name,
    }).eq('phone', phone);

    const program = matchProgram(message);
    if (program && existingLead.status === 'new') {
      await sb.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('phone', phone);

      const canSend = await canSendToLead(phone);
      if (!canSend) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const info = PROGRAM_CHECKOUT[program];
      const hinglish = isHinglish(market);
      const siteBase = 'https://www.fitnessbymaddy.com';
      const exlyBase = 'https://fitnessbymaddyy.exlyapp.com/checkout';

      await sendTemplate(phone, 'program_offer', {
        name: name || existingLead.name || 'there',
        templateParams: hinglish
          ? [
              `${info.name} program perfect hai aapke liye! Price: ${info.price}`,
              `Checkout: ${exlyBase}/${program}`,
              `Intake form bhi fill karo: ${siteBase}/intake?lead=${existingLead.id}`,
            ]
          : [
              `The ${info.name} program is perfect for you! Price: ${info.price}`,
              `Checkout here: ${exlyBase}/${program}`,
              `Also fill out your intake form: ${siteBase}/intake?lead=${existingLead.id}`,
            ],
      });

      return res.status(200).json({ action: 'program_offered', program });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
