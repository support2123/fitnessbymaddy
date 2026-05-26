const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { shouldEscalate, createEscalation } = require('../lib/escalation');
const {
  maskPhone, detectMarket, classifyIntent, isOptOut,
  isHinglishMarket, programLabel, programPrice, cors, parseBody,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.mobile || body.phone || body.from;
  const message = body.message || body.text || body.body || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();
  const market = detectMarket(phone);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
  });

  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (shouldEscalate(message)) {
    await createEscalation(phone, 'keyword_trigger', message);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!existingLead) {
    return await handleNewLead(db, phone, message, market, res);
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  return await handleReturningLead(db, existingLead, message, market, res);
};

async function handleNewLead(db, phone, message, market, res) {
  await db.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message,
    last_msg_at: new Date().toISOString(),
    market,
  });

  const hinglish = isHinglishMarket(market);
  const greeting = hinglish
    ? [
        "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?",
      ]
    : [
        "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?",
      ];

  await sendWhatsApp(phone, 'welcome_v1', greeting);
  return res.status(200).json({ action: 'new_lead_greeted' });
}

async function handleReturningLead(db, lead, message, market, res) {
  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', lead.id);

  const intent = classifyIntent(message);

  if (intent && lead.status === 'new') {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: intent })
      .eq('id', lead.id);

    const label = programLabel(intent);
    const price = programPrice(intent);
    const hinglish = isHinglishMarket(market);

    const qualifyMsg = hinglish
      ? [
          label,
          `$${price}`,
          `Perfect choice! ${label} ($${price}) — yeh program aapke liye best rahega. Checkout karo aur intake form bhi fill karo taaki hum start kar sakein.`,
        ]
      : [
          label,
          `$${price}`,
          `Great choice! ${label} ($${price}) — this program is perfect for your goals. Complete checkout and fill the intake form so we can get you started.`,
        ];

    await sendWhatsApp(phone, 'program_recommend', qualifyMsg);

    return res.status(200).json({ action: 'qualified', program: intent });
  }

  return res.status(200).json({ action: 'message_logged' });
}
