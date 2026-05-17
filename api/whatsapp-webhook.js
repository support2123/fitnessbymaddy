const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { detectMarket, isHinglish } = require('./lib/market');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'premium', 'flagship'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', name: '6-Week Home Program', price: '$67' },
];

function routeToProgram(message) {
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(message.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);

      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        program_interest: null,
        market,
        created_at: new Date().toISOString()
      });

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendWhatsApp(phone, 'welcome_v1_hi', [name || 'there']);
      } else {
        await sendWhatsApp(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const route = routeToProgram(message);
    if (route) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('id', existingLead.id);

      const market = existingLead.market || detectMarket(phone);
      const hinglish = isHinglish(market);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (hinglish) {
        await sendWhatsApp(phone, 'program_match_hi', [
          name || existingLead.name || 'there',
          route.name,
          route.price,
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendWhatsApp(phone, 'program_match_en', [
          name || existingLead.name || 'there',
          route.name,
          route.price,
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: route.program });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
