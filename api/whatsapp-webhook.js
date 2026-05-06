const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'personalised': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
  'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
};

function detectProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message, phone, name } = parseWebhook(req.body);
    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    // Check opt-out
    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    if (needsEscalation(message)) {
      await escalate(phone, 'Keyword trigger in message', message.slice(0, 200));
    }

    // Log inbound message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      // New lead — Flow A
      const market = detectMarket(phone);
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead', id: lead.id });
    }

    // Existing lead — Flow B (qualification)
    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const program = detectProgram(message);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const checkoutUrl = CHECKOUT_LINKS[program];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? [`Perfect! Yeh raha aapka checkout link: ${checkoutUrl}\n\nOnce done, please fill this intake form: ${intakeUrl}`]
        : [`Perfect! Here's your checkout link: ${checkoutUrl}\n\nOnce done, please fill this intake form: ${intakeUrl}`];

      await sendTemplate(phone, 'program_checkout', msg);
      return res.status(200).json({ action: 'qualified', program });
    }

    // Check if active client
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (client) {
      // Active client messaging — could be a question
      await escalate(phone, 'Client message needs attention', message.slice(0, 200));
      return res.status(200).json({ action: 'client_message_escalated' });
    }

    return res.status(200).json({ action: 'no_match' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhook(body) {
  // AiSensy webhook format
  if (body.message) {
    return {
      message: body.message,
      phone: body.phone || body.from,
      name: body.name || body.pushName || null
    };
  }
  // Meta Cloud API format (fallback)
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        message: msg.text?.body || '',
        phone: msg.from,
        name: change.contacts?.[0]?.profile?.name || null
      };
    }
  }
  return { message: null, phone: null, name: null };
}
