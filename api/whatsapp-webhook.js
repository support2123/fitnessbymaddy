const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home', 'no gym': '6wk_home', 'bodyweight': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message,
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalate(phone, `Message: "${message.slice(0, 80)}"`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone, name: name || null, source: 'whatsapp',
        status: 'new', first_msg: message, market,
      });

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp({
        phone, templateName: 'welcome_v1', params: welcomeParams,
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const matched = matchProgram(message);
    if (matched) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: matched, last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const programName = PROGRAM_NAMES[matched];
      const checkoutLink = CHECKOUT_LINKS[matched];
      const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgBody = market === 'IN'
        ? `Great choice! 🔥 ${programName} perfect hai tere liye.\n\nPayment link: ${checkoutLink}\n\nIntake form bhi fill karo (program start ke liye zaroori hai): ${intakeLink}`
        : `Great choice! 🔥 ${programName} is perfect for you.\n\nPayment link: ${checkoutLink}\n\nPlease also fill the intake form (required to start): ${intakeLink}`;

      await sendWhatsApp({
        phone, templateName: 'program_recommendation', params: [msgBody],
      });

      return res.status(200).json({ action: 'qualified', program: matched });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.response) {
    return {
      phone: body.response.from || body.response.sender,
      message: body.response.text || body.response.body || '',
      name: body.response.name || null,
    };
  }
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || null,
      };
    }
  }
  return {
    phone: body.phone || body.from || null,
    message: body.message || body.text || body.body || '',
    name: body.name || null,
  };
}
