const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./_lib/escalation');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: '$35' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home Program', price: '$35' },
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  let phone, text, name;
  const body = req.body;

  if (body.entry) {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.status(200).json({ ok: true });
    phone = '+' + msg.from;
    text = msg.text?.body || '';
    name = body.entry[0].changes[0].value.contacts?.[0]?.profile?.name || '';
  } else {
    phone = body.phone || body.mobile;
    text = body.message || body.text || body.response || '';
    name = body.name || '';
    if (phone && !phone.startsWith('+')) phone = '+' + phone;
  }

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    template_name: null,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy('Keyword trigger in message', phone, text.slice(0, 200));
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  if (!existingLead) {
    await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      program_interest: null,
      market,
    });

    const greeting = hinglish
      ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
      : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

    await sendWhatsApp(phone, 'welcome_v1', greeting);
    return res.status(200).json({ action: 'new_lead_greeted' });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  const lower = text.toLowerCase();
  const matched = PROGRAM_ROUTES.find(r => r.keywords.some(kw => lower.includes(kw)));

  if (matched) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: matched.program,
    }).eq('id', existingLead.id);

    const checkoutMsg = hinglish
      ? [matched.label, matched.price, `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`, `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`]
      : [matched.label, matched.price, `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`, `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`];

    await sendWhatsApp(phone, 'program_offer', checkoutMsg);
    return res.status(200).json({ action: 'qualified', program: matched.program });
  }

  return res.status(200).json({ action: 'no_match_awaiting' });
};
