const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logIncoming, detectMarket, isHinglish, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalate } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'irregular period'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  fortyplus: { keywords: ['40+', '40 plus', 'menopause', 'joints', 'over 40', 'above 40'], program: '40plus', name: '40+ Strong', price: '$50' },
  flagship: { keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'full program'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'confused'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' }
};

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();

  if (lower === 'stop' || lower === 'unsubscribe') return 'optout';

  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) return key;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.senderPhone || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const cleanPhone = phone.replace(/\D/g, '');
    await logIncoming(cleanPhone, message);
    const market = detectMarket(cleanPhone);
    const hinglish = isHinglish(market);

    if (needsEscalation(message)) {
      await escalate(cleanPhone, 'Lead message flagged', message);
    }

    const db = getSupabase();

    const intent = classifyIntent(message);

    if (intent === 'optout') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', cleanPhone);
      console.log(`Opt-out: ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone: cleanPhone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = hinglish
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or try a trial session first?'];

      await sendWhatsApp(cleanPhone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (intent && existingLead.status === 'new') {
      const route = PROGRAM_ROUTES[intent];
      await db.from('leads').update({
        status: 'qualified',
        program_interest: route.program
      }).eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const qualifyParams = hinglish
        ? [`${route.name} (${route.price}) bilkul aapke liye perfect hai!`, checkoutUrl, intakeUrl]
        : [`${route.name} (${route.price}) is perfect for you!`, checkoutUrl, intakeUrl];

      await sendWhatsApp(cleanPhone, 'program_recommend', qualifyParams);
      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
