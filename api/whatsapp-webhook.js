const { getClient } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { shouldEscalate, createEscalation } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'burn'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'periods', 'irregular'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample']
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Session Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97,
  '6wk_home': 97,
  'pcos': 45,
  '40plus': 50,
  '12wk': 200,
  'zoom_trial': 20,
  'zoom_pack': 150
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender || '';
    const body = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming({ phone, body });

    const db = getClient();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    // Check opt-out
    const lowerBody = body.toLowerCase().trim();
    if (lowerBody === 'stop' || lowerBody === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    // Check escalation triggers
    const escalationKeyword = shouldEscalate(body);
    if (escalationKeyword) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
      await createEscalation({
        phone,
        clientId: client?.id,
        reason: `Keyword detected: "${escalationKeyword}"`,
        messageBody: body
      });
    }

    // Check if existing lead
    const { data: existingLead } = await db.from('leads').select('*').eq('phone', phone).single();

    if (!existingLead) {
      // FLOW A: New lead
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength training, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: []
      });

      return res.json({ action: 'new_lead', leadId: newLead.id });
    }

    // FLOW B: Lead qualification based on reply keywords
    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const matched = matchProgram(body);

      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[matched];
        const price = PROGRAM_PRICES[matched];

        const qualifyMsg = hinglish
          ? `Great choice! 💪 ${programName} ($${price}) is perfect for you.\n\nCheckout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill karo: https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          : `Great choice! 💪 The ${programName} ($${price}) is perfect for your goals.\n\nCheckout here: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nAlso fill out your intake form: https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp({ phone, body: qualifyMsg });

        return res.json({ action: 'qualified', program: matched });
      }

      // Generic reply — update last message
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
