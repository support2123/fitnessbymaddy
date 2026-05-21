const { getSupabase } = require('./lib/supabase');
const { sendTemplate, notifyMaddy } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lean', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'over 40', '40+', 'forty'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6-Week Home' },
];

function routeProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(
        `Lead ${maskPhone(phone)} triggered escalation`,
        `Keyword: "${esc.reason}"\nMessage: "${text.slice(0, 200)}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      const templateName = isHinglish(market) ? 'welcome_v1' : 'welcome_v1_en';
      await sendTemplate(phone, templateName, [name || 'there']);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    const lead = existingLead[0];

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (lead.status === 'new') {
      const route = routeProgram(text);
      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', lead.id);

        const market = lead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `${route.name} — perfect choice! 🔥 Yeh raha checkout link:`
          : `${route.name} — great choice! 🔥 Here's your checkout link:`;

        await sendTemplate(phone, 'program_checkout', [
          name || 'there',
          route.name,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`,
          `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`
        ]);

        return res.status(200).json({ action: 'qualified', program: route.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
