const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, sendText } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$45' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'dedicated', 'advanced', 'flagship'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home', price: '$40' },
];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body || {};
    const phone = body.phone || body.from || body.senderPhone || '';
    const name = body.name || body.senderName || '';
    const text = body.message || body.text || body.body || '';
    const cleanPhone = phone.startsWith('+') ? phone : `+${phone}`;

    if (!cleanPhone || cleanPhone.length < 8) {
      return res.status(400).json({ error: 'Invalid phone' });
    }

    await db.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: text,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', cleanPhone);
      console.log(`Opt-out: ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', cleanPhone, text.slice(0, 200));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', clientId: existingClient.id });
    }

    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone: cleanPhone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        program_interest: null,
        market,
        created_at: new Date().toISOString(),
      }).select().single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or try a trial first?'];

      await sendTemplate(cleanPhone, 'welcome_v1', welcomeParams, false);
      return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = hinglish
        ? `Great choice! ${matched.label} program (${matched.price}) perfect hai aapke liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye form bhar do: ${intakeUrl}`
        : `Great choice! The ${matched.label} program (${matched.price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`;

      await sendText(cleanPhone, msg, false);
      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error(`Webhook error: ${err.message}`);
    return res.status(500).json({ error: 'Internal error' });
  }
};
