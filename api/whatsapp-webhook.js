const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40+', 'forty', 'menopause', 'joints', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personal', 'personalised'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Custom Program',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const payload = req.body;

    const phone = payload.mobile || payload.phone || payload.from;
    const name = payload.name || payload.pushName || '';
    const message = payload.text || payload.message || payload.body || '';

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    await db.from('messages').insert({
      phone: normalizedPhone,
      direction: 'in',
      body: message
    });

    if (checkOptOut(message)) {
      await db.from('leads')
        .update({ status: 'dropped' })
        .eq('phone', normalizedPhone);
      console.log(`Opt-out: ${maskPhone(normalizedPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation) {
      await notifyMaddy(
        'Lead/Client Escalation',
        `Phone: ${maskPhone(normalizedPhone)}\nTriggers: ${escalation.join(', ')}\nMessage: ${message.slice(0, 200)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (!existingLead) {
      const market = detectMarket(normalizedPhone);

      await db.from('leads').insert({
        phone: normalizedPhone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = isHinglish(market)
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(normalizedPhone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', normalizedPhone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const matched = matchProgram(message);
    if (matched) {
      await db.from('leads')
        .update({
          status: 'qualified',
          program_interest: matched
        })
        .eq('phone', normalizedPhone);

      const market = existingLead.market || detectMarket(normalizedPhone);
      const programName = PROGRAM_NAMES[matched] || matched;

      await sendTemplate(normalizedPhone, 'program_interest', {
        name: name || existingLead.name || 'there',
        templateParams: [
          name || existingLead.name || 'there',
          programName,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${matched}`,
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        ]
      });

      return res.status(200).json({ action: 'qualified', program: matched });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
