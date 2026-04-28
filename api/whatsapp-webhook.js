const { supabase } = require('./lib/supabase');
const { sendTemplate, sendToMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, isOptOut } = require('./lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'burn', 'lean', 'fat'],
  pcos: ['pcos', 'hormonal', 'hormone', 'irregular period'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+'],
  '12wk': ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'],
  zoom_trial: ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  pcos: 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  zoom_trial: 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const text = payload.text || payload.body || payload.message?.text || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await sendToMaddy(`ESCALATION [${maskPhone(phone)}]: "${text}" — trigger: ${esc.trigger}`);
      return res.json({ action: 'escalated', trigger: esc.trigger });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.json({ action: 'active_client', note: 'Routed to support flow' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market,
      });

      const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendTemplate(phone, welcomeTemplate, [name || 'there']);

      return res.json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'dropped_lead', note: 'No further messages' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    const matched = matchProgram(text);
    if (matched) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: matched })
        .eq('phone', phone);

      const checkoutUrl = CHECKOUT_LINKS[matched];
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
      const templateName = isHinglish(market) ? 'program_link_hi' : 'program_link_en';

      await sendTemplate(phone, templateName, [
        name || 'there',
        formatProgramName(matched),
        checkoutUrl,
        intakeUrl,
      ]);

      return res.json({ action: 'qualified', program: matched });
    }

    return res.json({ action: 'unmatched', text });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

function formatProgramName(code) {
  const names = {
    '6wk_gym': '6-Week Burn & Build',
    pcos: 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    '12wk': '12-Week Custom Flagship',
    zoom_trial: '$20 Zoom Trial Session',
  };
  return names[code] || code;
}
