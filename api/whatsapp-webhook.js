const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'advanced', 'flagship', 'personali'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test', 'start'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    for (const key of entry.keys) {
      if (lower.includes(key)) return entry;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logMessage(phone, 'in', text, null);

    if (text.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      await createEscalation(phone, escalationKeyword, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status, program_interest')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 2000),
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a $20 trial first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead_greeted', market });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || undefined })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      const matched = matchProgram(text);

      if (matched) {
        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', existingLead.id);

        const rateOk = await canSendMessage(phone);
        if (!rateOk) {
          return res.status(200).json({ action: 'rate_limited' });
        }

        const checkoutMsg = hinglish
          ? [
              `Great choice! ${matched.label} (${matched.price}) — yeh program tere liye perfect hai.`,
              `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
              `Intake form bhi fill karo: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`,
            ]
          : [
              `Great choice! ${matched.label} (${matched.price}) — this program is perfect for you.`,
              `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
              `Also fill your intake form: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`,
            ];

        await sendTemplate(phone, 'program_checkout', checkoutMsg);

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
