const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming, canSendMessage } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { detectMarket, isHinglish } = require('../lib/market');

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', 'serious', '12wk', 'flagship', 'twelve'], program: '12wk', label: '12-Week Flagship', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of KEYWORD_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    await logIncoming(phone, text);

    if (/\b(stop|unsubscribe)\b/i.test(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      await escalateToMaddy(`Message contains escalation trigger: "${text.slice(0, 100)}"`, lead || { phone, name: 'Unknown' });
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', []);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', []);
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const matched = matchProgram(text);
    if (matched) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: matched.program,
        })
        .eq('id', existing.id);

      const allowed = await canSendMessage(phone, false);
      if (allowed) {
        await sendTemplate(phone, 'program_checkout', [
          matched.label,
          `$${matched.price}`,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`,
        ]);

        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existing.id}`;
        await sendTemplate(phone, 'intake_form', [intakeUrl]);
      }

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
