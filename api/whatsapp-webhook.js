const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'slim': '6wk_gym', 'patla': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home', 'ghar': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'WhatsApp webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const body = req.body;

  const phone = body.mobile || body.phone || body.from || body.senderMobile;
  const text = body.message || body.text || body.body || '';
  const name = body.name || body.senderName || null;

  if (!phone) {
    return res.status(400).json({ error: 'No phone number' });
  }

  await db.from('messages').insert({
    phone, direction: 'in', body: text,
  });

  if (/\b(stop|unsubscribe)\b/i.test(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy({ reason: 'keyword_match', phone, name, message: text });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone, name, source: 'whatsapp', status: 'new',
      first_msg: text, last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const welcome = market === 'IN'
      ? `Hi${name ? ' ' + name : ''}! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi${name ? ' ' + name : ''}! Welcome to Fitness by Maddy. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendWhatsApp({ phone, templateName: 'welcome_v1', params: [name || 'there'] });

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'dropped_lead_ignored' });
  }

  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    const program = detectProgram(text);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const programName = PROGRAM_NAMES[program];
      const checkoutLink = CHECKOUT_LINKS[program];
      const intakeLink = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutLink}\n\nPehle ye intake form bhar do:\n${intakeLink}\n\nKoi sawaal ho toh pooch lo!`
        : `Great choice! ${programName} sounds perfect for you.\n\nCheckout here: ${checkoutLink}\n\nPlease fill out your intake form:\n${intakeLink}\n\nAny questions? Just ask!`;

      await sendWhatsApp({ phone, message: msg });

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
};
