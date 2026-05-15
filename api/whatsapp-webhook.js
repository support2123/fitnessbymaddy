const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, notifyMaddy } = require('../lib/escalation');
const { matchProgram } = require('../lib/program-keywords');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.from || payload.sender;
  const text = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.pushName || '';

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
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy('Medical/Sensitive keyword detected', { phone, message: text });
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    });

    const greeting = market === 'IN'
      ? ["Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
      : ["Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

    await sendTemplate(phone, 'welcome_v1', greeting);
    return res.status(200).json({ action: 'new_lead_greeted' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    const matched = matchProgram(text);
    if (matched) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matched.program,
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkoutPath}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? [matched.name, `₹${matched.price * 83}`, checkoutUrl, intakeUrl]
        : [matched.name, `$${matched.price}`, checkoutUrl, intakeUrl];

      await sendTemplate(phone, 'program_offer', msg);
      return res.status(200).json({ action: 'program_offered', program: matched.program });
    }
  }

  return res.status(200).json({ action: 'logged' });
};
