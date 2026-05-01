const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home' },
];

function routeToProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

function isOptOut(text) {
  const lower = (text || '').toLowerCase().trim();
  return lower === 'stop' || lower === 'unsubscribe' || lower === 'opt out';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const messageBody = payload.message || payload.text || payload.body || '';
    const senderName = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody,
    });

    if (isOptOut(messageBody)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(messageBody);
    if (escalationKeyword) {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .single();

      await createEscalation(
        phone,
        existingClient?.id || null,
        escalationKeyword,
        messageBody
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageBody,
          market,
        })
        .select()
        .single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', [welcomeMsg]);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', ignored: true });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const route = routeToProgram(messageBody);

      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program,
          last_msg_at: new Date().toISOString(),
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! 🔥 ${route.label} program tere liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nPehle ye intake form bhar do: ${intakeUrl}`
          : `Great choice! 🔥 The ${route.label} program is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this intake form first: ${intakeUrl}`;

        await sendText(phone, qualifyMsg);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      await db.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', existingLead.id);

      return res.status(200).json({ action: 'reply_logged' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    return res.status(200).json({ action: 'existing_lead_updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
