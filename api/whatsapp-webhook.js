const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, createEscalation, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build', price: 97 },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior', price: 45 },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'over 40'], program: '40plus', label: '40+ Strong', price: 50 },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship', 'advanced'], program: '12wk', label: '12-Week Custom', price: 200 },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial', price: 20 },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', label: '6-Week Home', price: 77 },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel messages'];

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
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    if (!change?.messages?.[0]) {
      return res.status(200).json({ ok: true, note: 'no message' });
    }

    const msg = change.messages[0];
    const contact = change.contacts?.[0];
    const phone = msg.from;
    const text = msg.text?.body || '';
    const name = contact?.profile?.name || null;

    console.log(`Incoming from ${maskPhone(phone)}: ${text.slice(0, 100)}`);

    const db = getClient();

    await logMessage(phone, 'in', text, null);

    if (OPT_OUT_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      await db.from('leads').update({ opted_out: true, status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(text);
    if (escalationKeyword) {
      const { data: client } = await db.from('clients').select('id').eq('phone', phone).single();
      await createEscalation(phone, escalationKeyword, text, client?.id);
      await notifyMaddy(phone, escalationKeyword, (p, b) => sendText(p, b, true));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped' && !existingLead.opted_out) {
        return res.status(200).json({ ok: true, note: 'dropped lead, not re-engaging' });
      }

      if (existingLead.status === 'new') {
        const matched = matchProgram(text);
        if (matched) {
          await db.from('leads').update({
            status: 'qualified',
            program_interest: matched.program,
          }).eq('id', existingLead.id);

          const market = existingLead.market;
          const hinglish = isHinglish(market);

          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const reply = hinglish
            ? `${matched.label} ($${matched.price}) — perfect choice! Yeh raha checkout link:\n${checkoutUrl}\n\nAur yeh intake form bhar do taaki hum tumhara plan customize kar sakein:\n${intakeUrl}`
            : `${matched.label} ($${matched.price}) — great choice! Here's your checkout link:\n${checkoutUrl}\n\nPlease also fill this intake form so we can customize your plan:\n${intakeUrl}`;

          await sendText(phone, reply, false);
          return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
        }
      }

      return res.status(200).json({ ok: true, note: 'existing lead, no keyword match' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 1000),
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const hinglish = isHinglish(market);
    const welcome = hinglish
      ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

    await sendTemplate(phone, 'welcome_v1', [name || 'there'], false);

    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program,
      }).eq('id', newLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${newLead.id}`;
      const reply = hinglish
        ? `${matched.label} ($${matched.price}) mein interest hai? Checkout:\n${checkoutUrl}\n\nIntake form:\n${intakeUrl}`
        : `Interested in ${matched.label} ($${matched.price})? Checkout here:\n${checkoutUrl}\n\nIntake form:\n${intakeUrl}`;

      await sendText(phone, reply, false);
    }

    return res.status(200).json({ ok: true, action: 'new_lead', id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(200).json({ ok: true, note: 'error handled' });
  }
};
