const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { checkEscalation, checkOptOut, createEscalation } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'over 40', '40+', 'forty'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'personalised', 'personalized', 'flagship'], program: '12wk', name: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: '$20 Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home', 'home workout'], program: '6wk_home', name: '6-Week Home Program' }
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const messageBody = (payload.message || payload.text || payload.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    console.log(`Incoming from ${maskPhone(phone)}: ${messageBody.slice(0, 50)}`);

    await logMessage(phone, 'in', messageBody, null);

    if (checkOptOut(messageBody)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = checkEscalation(messageBody);
    if (escalationKeyword) {
      await createEscalation(phone, `Keyword detected: ${escalationKeyword}`, messageBody);
    }

    const db = getSupabase();
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      const action = await handleNewLead(phone, messageBody);
      return res.status(200).json({ action });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const action = await handleQualification(existingLead, messageBody);
      return res.status(200).json({ action });
    }

    return res.status(200).json({ action: 'logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(phone, messageBody) {
  const db = getSupabase();
  const market = detectMarket(phone);

  await db.from('leads').insert({
    phone,
    first_msg: messageBody,
    market,
    status: 'new',
    last_msg_at: new Date().toISOString()
  });

  await sendTemplate(phone, 'welcome_v1', ['there']);

  return 'new_lead_welcomed';
}

async function handleQualification(lead, messageBody) {
  const db = getSupabase();
  const lower = messageBody.toLowerCase();
  const hinglish = isHinglish(lead.market);

  for (const route of PROGRAM_ROUTES) {
    const matched = route.keywords.some(kw => lower.includes(kw));
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: route.program
      }).eq('id', lead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

      if (hinglish) {
        await sendTemplate(lead.phone, 'program_match_hi', [
          route.name,
          checkoutUrl,
          intakeUrl
        ]);
      } else {
        await sendTemplate(lead.phone, 'program_match_en', [
          route.name,
          checkoutUrl,
          intakeUrl
        ]);
      }

      return `qualified_${route.program}`;
    }
  }

  if (hinglish) {
    await sendTemplate(lead.phone, 'clarify_goal_hi', ['there']);
  } else {
    await sendTemplate(lead.phone, 'clarify_goal_en', ['there']);
  }

  return 'asked_clarification';
}

async function handleOptOut(phone) {
  const db = getSupabase();
  await db.from('leads').update({
    status: 'dropped',
    opted_out: true
  }).eq('phone', phone);
  console.log(`Opt-out processed: ${maskPhone(phone)}`);
}

function normalizePhone(raw) {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) {
    if (phone.length === 10) phone = '+91' + phone;
    else phone = '+' + phone;
  }
  return phone;
}
