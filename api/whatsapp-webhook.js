const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'mature'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom Program', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home Program', price: '$97' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

function isOptOut(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const text = payload.text || payload.body || payload.message || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy(
        'Medical/sensitive keyword detected',
        `Phone: ${maskPhone(phone)} | Message: ${text.slice(0, 100)}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient[0].id });
    }

    const market = detectMarket(phone);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: welcomeParams
      }, true);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const matched = matchProgram(text);
    if (matched) {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: matched.program
        })
        .eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      const msgParams = market === 'IN'
        ? [`${matched.name} - ${matched.price}! Checkout: ${checkoutUrl} | Intake form: ${intakeUrl}`]
        : [`${matched.name} - ${matched.price}! Checkout: ${checkoutUrl} | Intake form: ${intakeUrl}`];

      await sendWhatsApp(phone, 'program_checkout', {
        name: name || lead.name || 'there',
        templateParams: msgParams
      }, true);

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
