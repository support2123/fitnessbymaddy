const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' }
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
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
  const payload = req.body;

  const phone = payload.mobile || payload.from || payload.senderMobile || '';
  const text = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.senderName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await db.from('messages').insert({
    phone, direction: 'in', body: text
  });

  const lower = text.toLowerCase().trim();
  if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
    await db.from('leads').upsert({ phone, opted_out: true, status: 'dropped' }, { onConflict: 'phone' });
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy({
      reason: 'Keyword trigger in message',
      phone,
      details: `Message: ${text.slice(0, 200)}`
    });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1);

  const market = detectMarket(phone);
  const isHinglish = market === 'IN';

  if (!existingLead || existingLead.length === 0) {
    await db.from('leads').insert({
      phone, name, source: 'whatsapp', status: 'new',
      first_msg: text, last_msg_at: new Date().toISOString(),
      market
    });

    const welcome = isHinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      body: welcome,
      params: [name || 'there']
    });

    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  const lead = existingLead[0];

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (lead.status === 'new' || lead.status === 'qualified') {
    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program
      }).eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

      const msg = isHinglish
        ? `Great choice! 💪 ${matched.label} program tumhare liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nAur ye form bhi fill karo taaki hum tumhara plan customize kar sakein:\n${intakeUrl}`
        : `Great choice! 💪 The ${matched.label} program is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nAlso fill out this form so we can customise your plan:\n${intakeUrl}`;

      await sendWhatsApp({ phone, body: msg });

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
};
