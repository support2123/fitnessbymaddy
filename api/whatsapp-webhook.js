const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'mature'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'twelve', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', label: '12-Week Custom Training' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', label: 'Zoom Trial Session' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home Program' },
];

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
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
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const body = req.body;
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.status(200).json({ ok: true, note: 'no message' });
    }

    const phone = '+' + message.from;
    const text = message.text?.body || '';
    const name = value.contacts?.[0]?.profile?.name || null;
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (checkOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    const escalation = checkEscalation(text);
    if (escalation.escalate) {
      await notifyMaddy(
        `Lead requires attention (${escalation.reason})`,
        `Phone: ${maskPhone(phone)}\nName: ${name || 'Unknown'}\nMessage: ${text}`
      );
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      if (escalation.escalate) {
        await notifyMaddy(
          `Active client needs help (${escalation.reason})`,
          `Client ID: ${existingClient.id}\nPhone: ${maskPhone(phone)}\nMessage: ${text}`
        );
      }
      return res.status(200).json({ ok: true, action: 'client_message_logged' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ ok: true, action: 'new_lead' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'dropped_lead_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_match', [
        name || 'there',
        matched.label,
        checkoutUrl,
        intakeUrl
      ]);

      return res.status(200).json({ ok: true, action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(200).json({ ok: true, note: 'error handled' });
  }
};
