const { supabase } = require('./lib/supabase');
const { detectMarket, isHinglish, canSendMessage, sendTemplate, logIncomingMessage, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'slim', 'burn'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'senior', 'over 40'],
  '12wk': ['custom', '12 week', '12week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure']
};

function classifyIntent(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

function getProgramName(key) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    '6wk_home': '6-Week Home Burn',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Custom Training',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Pack'
  };
  return names[key] || key;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncomingMessage(phone, text);

    const lower = (text || '').toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Keyword trigger in message',
        `Phone: ${maskPhone(phone)} | Message: ${text}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, [name || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const intent = classifyIntent(text);

      if (intent) {
        const market = existingLead.market || detectMarket(phone);
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: intent
        }).eq('id', existingLead.id);

        const programName = getProgramName(intent);
        const hinglish = isHinglish(market);

        const checkoutMsg = hinglish
          ? `Great choice! ${programName} ke liye checkout karein: https://fitnessbymaddyy.exlyapp.com/checkout/${intent}\n\nApna intake form bhi fill karein: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Great choice! Checkout for ${programName}: https://fitnessbymaddyy.exlyapp.com/checkout/${intent}\n\nAlso fill your intake form: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (await canSendMessage(phone)) {
          await sendTemplate(phone, 'program_checkout', [programName]);
        }

        return res.status(200).json({ action: 'qualified', program: intent });
      }

      if (await canSendMessage(phone)) {
        const market = existingLead.market || 'IN';
        const nudgeMsg = isHinglish(market)
          ? 'Koi baat nahi! Pehle ek $20 trial Zoom session try karo — https://www.fitnessbymaddy.com/program-trial.html'
          : 'No worries! Try a $20 trial Zoom session first — https://www.fitnessbymaddy.com/program-trial.html';

        await sendTemplate(phone, 'nudge_trial', [name || 'there']);
      }

      return res.status(200).json({ action: 'awaiting_classification' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
