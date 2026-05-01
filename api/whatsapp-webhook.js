const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, canSendMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' },
];

function routeProgram(text) {
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
  const body = req.body;

  const phone = body.phone || body.from || body.senderPhone || '';
  const text = body.text || body.message || body.body || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy('Sensitive keyword detected', phone, text.slice(0, 200));
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  const market = detectMarket(phone);

  if (!existingLead) {
    const { data: lead } = await db.from('leads').insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, []);

    return res.json({ action: 'new_lead', lead_id: lead.id });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    const route = routeProgram(text);
    if (route) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: route.program })
        .eq('id', existingLead.id);

      if (await canSendMessage(phone)) {
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [route.label, checkoutUrl, intakeUrl]);
        } else {
          await sendTemplate(phone, 'program_match', [route.label, checkoutUrl, intakeUrl]);
        }
      }

      return res.json({ action: 'qualified', program: route.program });
    }
  }

  return res.json({ action: 'logged' });
};
