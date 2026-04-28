const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy, isOptOut } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name: senderName } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const incomingText = (message || '').trim();

    await db.from('messages').insert({
      phone, direction: 'in', body: incomingText
    });

    if (isOptOut(incomingText)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(incomingText)) {
      await escalateToMaddy('Keyword trigger in message', phone, incomingText.slice(0, 200));
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
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: incomingText,
        market
      }).select().single();

      const welcomeParams = isHinglish(market)
        ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.json({ action: 'new_lead', id: newLead.id, market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const matched = matchProgram(incomingText);

    if (matched && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program
      }).eq('id', existingLead.id);

      const rateOk = await canSendMessage(phone);
      if (!rateOk) {
        return res.json({ action: 'rate_limited', program: matched.program });
      }

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = isHinglish(market)
        ? [`${matched.name} (${matched.price}) aapke liye perfect hai! Checkout: ${checkoutUrl} | Intake form: ${intakeUrl}`]
        : [`${matched.name} (${matched.price}) is perfect for you! Checkout: ${checkoutUrl} | Fill your intake form: ${intakeUrl}`];

      await sendTemplate(phone, 'program_match', msg);

      return res.json({ action: 'qualified', program: matched.program });
    }

    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error for', maskPhone(req.body?.phone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
