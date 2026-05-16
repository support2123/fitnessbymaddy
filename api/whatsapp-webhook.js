const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'irregular'], program: 'pcos', name: 'PCOS Warrior' },
  fortyplus: { keywords: ['40', 'menopause', 'joints', 'joint', 'fifty', 'age'], program: '40plus', name: '40+ Strong' },
  custom: { keywords: ['custom', '12 week', 'serious', 'advanced', 'premium', 'flagship'], program: '12wk', name: '12-Week Flagship' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' }
};

function routeProgram(message) {
  const lower = message.toLowerCase();
  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return { key, ...route };
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookBody(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', {
        clientName: name || 'Unknown',
        phone,
        details: message.slice(0, 200)
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const route = routeProgram(message);
    if (route) {
      await supabase.from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('phone', phone);

      const market = existingLead.market || 'IN';
      const checkoutMsg = market === 'IN'
        ? [`${route.name}`, 'https://fitnessbymaddyy.exlyapp.com/checkout/' + route.key, 'https://fitnessbymaddy.com/intake.html?lead=' + existingLead.id]
        : [`${route.name}`, 'https://fitnessbymaddyy.exlyapp.com/checkout/' + route.key, 'https://fitnessbymaddy.com/intake.html?lead=' + existingLead.id];

      await sendWhatsApp(phone, 'program_checkout', checkoutMsg);
      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseWebhookBody(body) {
  if (body.payload && body.payload.type === 'text') {
    return {
      phone: body.payload.sender?.phone || body.payload.from,
      message: body.payload.text?.body || body.payload.payload?.text || '',
      name: body.payload.sender?.name || null
    };
  }
  if (body.entry && body.entry[0]) {
    const change = body.entry[0].changes?.[0]?.value;
    const msg = change?.messages?.[0];
    if (msg) {
      return {
        phone: msg.from,
        message: msg.text?.body || '',
        name: change.contacts?.[0]?.profile?.name || null
      };
    }
  }
  return {
    phone: body.phone || body.from,
    message: body.message || body.text || body.body || '',
    name: body.name || null
  };
}
