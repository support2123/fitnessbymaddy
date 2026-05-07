const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, classifyEscalationReason } = require('../lib/escalation');

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout'];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'burn'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', '40+', '40 plus'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo']
};

function classifyIntent(message) {
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function getProgramName(key) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Shred',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Custom Flagship',
    'zoom_trial': '$20 Zoom Trial',
    'zoom_pack': 'Zoom Session Pack'
  };
  return names[key] || key;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
      status: 'received'
    });

    const lowerMsg = messageBody.toLowerCase().trim();
    if (STOP_WORDS.some(w => lowerMsg === w || lowerMsg.startsWith(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(messageBody);
    if (escalationKeyword) {
      const reason = classifyEscalationReason(escalationKeyword);
      await db.from('escalations').insert({
        phone,
        reason,
        message_body: messageBody
      });

      const { notifyMaddy } = require('../lib/whatsapp');
      await notifyMaddy(reason, `Phone: ${maskPhone(phone)}\nMsg: ${messageBody.slice(0, 200)}`);
      return res.status(200).json({ action: 'escalated', reason });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        market
      });

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! This is Maddy\'s team. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped_lead' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = classifyIntent(messageBody);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const programName = getProgramName(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const params = hinglish
          ? [programName, `Checkout: ${checkoutUrl}`, `Intake form: ${intakeUrl}`]
          : [programName, `Checkout: ${checkoutUrl}`, `Intake form: ${intakeUrl}`];

        await sendTemplate(phone, 'program_offer', params);
        return res.status(200).json({ action: 'qualified', program });
      }

      const nudgeParams = hinglish
        ? ['Koi specific goal batao na — fat loss, PCOS, strength, ya 40+ fitness? Ya $20 trial try karo pehle!']
        : ['Tell us your specific goal — fat loss, PCOS, strength, or 40+ fitness? Or try our $20 trial first!'];

      await sendTemplate(phone, 'clarify_goal', nudgeParams);
      return res.status(200).json({ action: 'asked_for_clarification' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
