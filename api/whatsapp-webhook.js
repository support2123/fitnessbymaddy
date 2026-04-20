const { supabase } = require('./_lib/supabase');
const { sendTemplate, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'advanced'], program: '12wk', label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keys: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keys.some((k) => lower.includes(k))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const body = payload.text || payload.body || payload.message?.text || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logIncoming(phone, body);

    if (/\b(stop|unsubscribe)\b/i.test(body)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await escalateToMaddy('Keyword trigger in incoming message', { phone, body });
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existing && existing.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existing) {
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: body,
        market,
      }).select().single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    const matched = matchProgram(body);
    if (matched) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: matched.program,
        last_msg_at: new Date().toISOString(),
      }).eq('id', existing.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

      const msgParams = hinglish
        ? [matched.label, `Yeh raha tera checkout link: ${checkoutUrl}`, `Aur yeh intake form bhar de: ${intakeUrl}`]
        : [matched.label, `Here's your checkout link: ${checkoutUrl}`, `Please fill out the intake form: ${intakeUrl}`];

      await sendTemplate(phone, 'program_match', msgParams);
      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);
    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
