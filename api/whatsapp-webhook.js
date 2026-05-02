const { getSupabase } = require('./lib/supabase');
const { sendTemplate, logMessage, notifyMaddy, canSendToLead } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { checkEscalation, checkOptOut } = require('./lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40+', '40 plus', 'menopause', 'joints', 'joint pain', 'over 40'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised'], program: '12wk', label: '12-Week Custom Program', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'sample'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
];

function matchProgram(text) {
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
  const payload = req.body;

  const phone = payload.from || payload.senderPhone || payload.waId || '';
  const text = payload.text || payload.message || payload.body || '';
  const senderName = payload.senderName || payload.pushName || null;

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  await logMessage(phone, 'in', text, null);

  if (checkOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  const escalationTrigger = checkEscalation(text);
  if (escalationTrigger) {
    await db.from('escalations').insert({
      phone,
      reason: escalationTrigger,
      message_body: text.slice(0, 500)
    });
    await notifyMaddy('Escalation', `Keyword "${escalationTrigger}" from ${phone.slice(-4)}`);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const hinglish = isHinglish(market);
    await sendTemplate(phone, 'welcome_v1', [
      senderName || (hinglish ? 'there' : 'there')
    ]);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'dropped_lead_ignored' });
  }

  const matched = matchProgram(text);
  if (matched && existingLead.status === 'new') {
    await db.from('leads')
      .update({
        status: 'qualified',
        program_interest: matched.program
      })
      .eq('id', existingLead.id);

    const market = existingLead.market || 'GLOBAL';
    const hinglish = isHinglish(market);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    if (hinglish) {
      await sendTemplate(phone, 'program_info_hi', [
        existingLead.name || 'there',
        matched.label,
        matched.price,
        checkoutUrl,
        intakeUrl
      ]);
    } else {
      await sendTemplate(phone, 'program_info_en', [
        existingLead.name || 'there',
        matched.label,
        matched.price,
        checkoutUrl,
        intakeUrl
      ]);
    }

    return res.status(200).json({ action: 'qualified', program: matched.program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
