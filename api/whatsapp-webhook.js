const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'fat'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'home workout', 'bodyweight'], program: '6wk_home', name: '6-Week Home Program', price: '$79' },
];

function routeToProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received',
    });

    if (isOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
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
        market,
      });

      await sendWhatsApp(phone, 'welcome_v1', [name || 'there']);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeToProgram(message);
      if (route) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: route.program })
          .eq('id', existingLead.id);

        await sendWhatsApp(phone, 'program_recommendation', [
          name || existingLead.name || 'there',
          route.name,
          route.price,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`,
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`,
        ]);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      await sendWhatsApp(phone, 'clarify_goal', [existingLead.name || 'there']);
      return res.status(200).json({ action: 'asked_clarification' });
    }

    return res.status(200).json({ action: 'existing_lead_noted' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (body.contactPhone) {
    return {
      phone: body.contactPhone,
      message: body.text || body.message || '',
      name: body.contactName || body.pushName || null,
    };
  }
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    const contact = changes?.contacts?.[0];
    return {
      phone: msg?.from ? '+' + msg.from : null,
      message: msg?.text?.body || '',
      name: contact?.profile?.name || null,
    };
  }
  return {
    phone: body.phone || body.from || null,
    message: body.message || body.text || body.body || '',
    name: body.name || null,
  };
}
