const { getSupabase } = require('../lib/supabase');
const { sendRateLimited, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { checkOptOut, checkEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'burn'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom Training',
  'zoom_trial': '$20 Zoom Trial',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function detectProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message, null);

    if (checkOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.escalate) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .maybeSingle();

      await createEscalation(phone, escalation.reason, message, client?.id);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = isHinglish(market)
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendRateLimited(phone, 'welcome_v1', welcomeParams, welcomeParams[0]);

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name,
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const program = detectProgram(message);
    if (program && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program];
      const checkoutLink = CHECKOUT_LINKS[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      let replyMsg;
      if (isHinglish(market)) {
        replyMsg = `Great choice! ${programName} aapke liye perfect hai. Yahan se checkout karo: ${checkoutLink}\n\nAur pehle ye intake form bhar do: ${intakeLink}`;
      } else {
        replyMsg = `Great choice! ${programName} is perfect for you. Checkout here: ${checkoutLink}\n\nPlease also fill out this intake form: ${intakeLink}`;
      }

      await sendRateLimited(phone, 'program_checkout', [programName, checkoutLink, intakeLink], replyMsg);

      return res.status(200).json({ action: 'lead_qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
