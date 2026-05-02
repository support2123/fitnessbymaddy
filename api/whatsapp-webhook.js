const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'premium': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
  'home': '6wk_home',
  'no gym': '6wk_home',
  'home workout': '6wk_home',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = extractPhone(payload);
    const message = extractMessage(payload);
    const name = extractName(payload);

    if (!phone || !message) {
      return res.status(200).json({ status: 'ignored', reason: 'no phone or message' });
    }

    const supabase = getSupabase();
    const market = detectMarket(phone);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ status: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message });
      return res.status(200).json({ status: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const greeting = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', greeting);
      return res.status(200).json({ status: 'new_lead_greeted' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ status: 'ignored_dropped' });
    }

    const program = matchProgram(message);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutUrl = CHECKOUT_LINKS[program];
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const params = market === 'IN'
        ? [checkoutUrl, intakeUrl]
        : [checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_checkout', params);
      return res.status(200).json({ status: 'qualified', program });
    }

    return res.status(200).json({ status: 'received', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractPhone(payload) {
  if (payload.phone) return payload.phone;
  if (payload.mobile) return payload.mobile;
  if (payload.waId) return '+' + payload.waId;
  if (payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from) {
    return '+' + payload.entry[0].changes[0].value.messages[0].from;
  }
  if (payload.data?.from) return payload.data.from;
  return null;
}

function extractMessage(payload) {
  if (payload.message) return payload.message;
  if (payload.text) return payload.text;
  if (payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body) {
    return payload.entry[0].changes[0].value.messages[0].text.body;
  }
  if (payload.data?.text) return payload.data.text;
  return null;
}

function extractName(payload) {
  if (payload.name) return payload.name;
  if (payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name) {
    return payload.entry[0].changes[0].value.contacts[0].profile.name;
  }
  return null;
}

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}
