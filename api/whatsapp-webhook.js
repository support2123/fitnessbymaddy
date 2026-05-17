const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { shouldEscalate, escalateToMaddy, isOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$45' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  forty_plus: { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', '40+'], program: '40plus', name: '40+ Strong', price: '$50' },
  flagship: { keywords: ['custom', '12 week', '12wk', 'serious', 'advanced', 'full'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: (message || '').substring(0, 500),
      status: 'received',
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (shouldEscalate(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone, message });
      return res.status(200).json({ action: 'escalated' });
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
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: (message || '').substring(0, 500),
        market,
      }).select().single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const route = matchProgram(message);
    if (route) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: route.program,
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const market = existingLead.market || 'IN';
      const msgParams = market === 'IN'
        ? [`Great choice! 🔥 ${route.name} (${route.price}) perfect hai tere goal ke liye.\n\n✅ Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nPayment ke baad turant access milega!`]
        : [`Great choice! 🔥 ${route.name} (${route.price}) is perfect for your goal.\n\n✅ Checkout: ${checkoutUrl}\n📋 Intake form: ${intakeUrl}\n\nYou'll get instant access after payment!`];

      await sendWhatsApp(phone, 'program_offer', msgParams);

      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    return res.status(200).json({ action: 'received', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.message && body.mobile) {
    return { phone: body.mobile, message: body.message, name: body.name };
  }
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    const contact = change?.contacts?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: contact?.profile?.name || '',
    };
  }
  return { phone: body.phone, message: body.message, name: body.name };
}

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}
