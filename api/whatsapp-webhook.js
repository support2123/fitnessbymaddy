const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone, detectMarket, isHinglish } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendTo, logMessage } = require('./lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'fat'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const phone = body.mobile || body.phone || body.from || '';
  const message = body.message || body.text || body.body || '';
  const senderName = body.name || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const db = getSupabase();
  const market = detectMarket(phone);

  await logMessage(phone, 'in', message, null);

  const lower = (message || '').toLowerCase().trim();
  if (STOP_WORDS.some(w => lower.includes(w))) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy('Incoming message flagged', {
      name: senderName,
      phone: maskPhone(phone),
      details: message.slice(0, 200),
    });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    });

    const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
    await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);
    await logMessage(phone, 'out', 'Welcome message sent', welcomeTemplate);

    return res.status(200).json({ action: 'new_lead', market });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  const matched = matchProgram(message);
  if (matched) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: matched.program,
    }).eq('phone', phone);

    const allowed = await canSendTo(phone);
    if (allowed) {
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const templateName = isHinglish(market) ? 'program_match_hi' : 'program_match';
      await sendTemplate(phone, templateName, [
        senderName || 'there',
        matched.label,
        checkoutUrl,
        intakeUrl,
      ]);
      await logMessage(phone, 'out', `Matched: ${matched.label}`, templateName);
    }

    return res.status(200).json({ action: 'qualified', program: matched.program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
