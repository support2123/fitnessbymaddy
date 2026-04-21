const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncoming } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'slim', 'cut'], program: '6wk_gym', name: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'advanced', 'flagship'], program: '12wk', name: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home', 'home workout'], program: '6wk_home', name: '6-Week Home Program' },
];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

function parseWebhookBody(body) {
  if (body?.phone && body?.message) {
    return { phone: body.phone, message: body.message, name: body.name || null };
  }
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name || null,
    };
  }
  return { phone: null, message: null, name: null };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') {
    const challenge = req.query['hub.challenge'];
    if (challenge) return res.status(200).send(challenge);
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const { phone, message, name: senderName } = parseWebhookBody(req.body);

  if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

  await logIncoming({ phone, body: message });

  if (['stop', 'unsubscribe'].includes(message.trim().toLowerCase())) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    const { data: lead } = await db.from('leads').select('name').eq('phone', phone).limit(1).single();
    await escalateToMaddy({
      reason: 'Keyword trigger in message',
      phone,
      message,
      clientName: lead?.name || senderName,
    });
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
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    }).select().single();

    const welcomeBody = hinglish
      ? "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here \u{1F44B} What's your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendWhatsApp({ phone, templateName: 'welcome_v1', body: welcomeBody });
    return res.json({ action: 'new_lead', leadId: newLead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.json({ action: 'lead_dropped_no_reply' });
  }

  const matched = matchProgram(message);
  if (matched) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: matched.program,
    }).eq('id', existingLead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const qualifyBody = hinglish
      ? `Great choice! \u{1F525} ${matched.name} — yeh program tere liye perfect hai.\n\n\u{1F4B3} Checkout: ${checkoutUrl}\n\u{1F4CB} Intake form bhi fill kardo: ${intakeUrl}\n\nKoi question ho toh pooch le!`
      : `Great choice! \u{1F525} ${matched.name} — this program is perfect for your goals.\n\n\u{1F4B3} Checkout: ${checkoutUrl}\n\u{1F4CB} Please fill the intake form too: ${intakeUrl}\n\nAny questions? Just ask!`;

    await sendWhatsApp({ phone, templateName: 'qualify_program', body: qualifyBody });
    return res.json({ action: 'qualified', program: matched.program });
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    return res.json({ action: 'active_client_message', clientId: existingClient.id });
  }

  const promptBody = hinglish
    ? "Got it! Bata — kaun sa goal focus karna hai?\n\n1️⃣ Fat loss / Shred\n2️⃣ PCOS management\n3️⃣ 40+ fitness\n4️⃣ 12-week custom program\n5️⃣ Zoom trial ($20)"
    : "Got it! Which goal would you like to focus on?\n\n1️⃣ Fat loss / Shred\n2️⃣ PCOS management\n3️⃣ 40+ fitness\n4️⃣ 12-week custom program\n5️⃣ Zoom trial ($20)";

  await sendWhatsApp({ phone, templateName: 'goal_menu', body: promptBody });
  return res.json({ action: 'prompted_goal' });
};
