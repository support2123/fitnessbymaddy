const { getSupabase } = require('../lib/supabase');
const { detectMarket, classifyIntent, needsEscalation, isHinglish, maskPhone, programLabel, cors } = require('../lib/helpers');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const payload = req.body;
  const phone = payload.phone || payload.from || payload.sender;
  const text = payload.text || payload.message || payload.body || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const db = getSupabase();

  await logMessage(phone, 'in', text, null);

  if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy('Lead message requires review', `Phone: ${maskPhone(phone)}\nMessage: ${text}`);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: lead } = await db.from('leads').insert({
      phone,
      name: payload.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    const greeting = isHinglish(market)
      ? ["Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
      : ["Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

    await sendTemplate(phone, 'welcome_v1', greeting);

    return res.json({ action: 'new_lead', lead_id: lead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.json({ action: 'ignored_dropped' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  const intent = classifyIntent(text);
  if (intent && existingLead.status === 'new') {
    const program = intent;
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program
    }).eq('id', existingLead.id);

    const market = existingLead.market || 'GLOBAL';
    const label = programLabel(program);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const msg = isHinglish(market)
      ? `${label} — bilkul sahi choice! Yeh raha checkout link:\n${checkoutUrl}\n\nAur yeh form bhar do taaki hum aapke liye plan customize kar sakein:\n${intakeUrl}`
      : `Great choice — ${label}! Here's your checkout link:\n${checkoutUrl}\n\nPlease also fill out this quick form so we can customize your plan:\n${intakeUrl}`;

    await sendText(phone, msg);

    return res.json({ action: 'qualified', program });
  }

  return res.json({ action: 'noted' });
};
