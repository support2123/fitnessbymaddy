const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone, detectMarket, isHinglish } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$40' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'advanced', 'personalised'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel'];

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const supabase = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logMessage(phone, 'in', message);

    if (OPT_OUT_KEYWORDS.some(kw => (message || '').toLowerCase().includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await logMessage(phone, 'out', 'Opt-out acknowledged', 'opt_out');
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', phone, message?.substring(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message?.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      });

      const allowed = await canSendMessage(phone);
      if (allowed) {
        const welcomeMsg = hinglish
          ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
          : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?";

        await sendTemplate(phone, 'welcome_v1', {
          name: name || 'there',
          templateParams: [name || 'there'],
        });
        await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');
      }

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' && message) {
      const matched = matchProgram(message);
      if (matched) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', existingLead.id);

        const allowed = await canSendMessage(phone);
        if (allowed) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const replyMsg = hinglish
            ? `Great choice! 🔥 ${matched.label} (${matched.price}) perfect hai tere liye.\n\n` +
              `Checkout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
            : `Great choice! 🔥 The ${matched.label} (${matched.price}) is perfect for you.\n\n` +
              `Checkout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

          await sendText(phone, replyMsg);
          await logMessage(phone, 'out', replyMsg, 'program_match');
        }

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      const allowed = await canSendMessage(phone);
      if (allowed) {
        const clarifyMsg = hinglish
          ? "Got it! Thoda aur batao — fat loss, PCOS, 40+ fitness, ya full 12-week custom program? Ya $20 trial try karna hai?"
          : "Got it! Tell me more — looking for fat loss, PCOS management, 40+ fitness, or the full 12-week custom program? Or try a $20 trial?";

        await sendText(phone, clarifyMsg);
        await logMessage(phone, 'out', clarifyMsg, 'clarify');
      }
    }

    return res.status(200).json({ action: 'processed' });
  } catch (err) {
    console.error('[Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
