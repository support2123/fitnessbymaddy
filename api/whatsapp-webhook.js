const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose fat', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'aging'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal'], program: '12wk', label: '12-Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial Session' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', label: '6-Week Home Program' },
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
  return ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'].includes(lower);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const body = req.body;

  const phone = body.phone || body.senderPhone || body.from || '';
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.senderName || '';

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone number' });
  }

  await logIncoming(phone, message);

  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  const escReason = needsEscalation(message);
  if (escReason) {
    const lead = await db.from('leads').select('id').eq('phone', phone).single();
    await createEscalation('lead', lead.data?.id, phone, escReason, message);
    await sendWhatsApp(phone, 'escalation_ack', {
      name: name || 'there',
      templateParams: ['Maddy will personally review your message and get back to you shortly.']
    });
    return res.status(200).json({ action: 'escalated', reason: escReason });
  }

  const existing = await db.from('leads').select('*').eq('phone', phone).single();

  if (!existing.data) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market
    }).select().single();

    await sendWhatsApp(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there']
    });

    return res.status(200).json({ action: 'new_lead', id: lead.id });
  }

  if (existing.data.status === 'dropped') {
    return res.status(200).json({ action: 'dropped_lead_ignored' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  const route = routeToProgram(message);
  if (route) {
    await db.from('leads')
      .update({ status: 'qualified', program_interest: route.program })
      .eq('phone', phone);

    const market = existing.data.market || 'IN';
    const lang = market === 'IN' ? 'hinglish' : 'english';
    const templateName = lang === 'hinglish' ? 'program_match_hi' : 'program_match_en';

    await sendWhatsApp(phone, templateName, {
      name: name || existing.data.name || 'there',
      templateParams: [
        route.label,
        `https://fitnessbymaddy.com/intake?lead=${existing.data.id}`
      ]
    });

    return res.status(200).json({ action: 'qualified', program: route.program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
