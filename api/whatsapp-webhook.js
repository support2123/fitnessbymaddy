const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket, isHinglish } = require('../lib/whatsapp');
const { classifyIntent, getProgramLabel, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body;
  const phone = body.phone || body.senderPhone || body.from;
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.senderName || '';

  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const db = getSupabase();
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  await db.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'in',
    body: text.slice(0, 500),
    status: 'received',
  });

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
    });

    const welcomeParams = hinglish
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

    await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  const intent = classifyIntent(text);

  if (intent.type === 'stop') {
    await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (intent.type === 'escalate') {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [maskPhone(phone), intent.keyword, text.slice(0, 200)]
    );
    const ackMsg = hinglish
      ? ['Bilkul, main Maddy ko inform kar rahi hoon. Woh aapse jald connect karengi.']
      : ['Absolutely, I\'m flagging this to Maddy. She\'ll connect with you shortly.'];
    await sendWhatsApp(phone, 'escalation_ack', ackMsg);
    return res.status(200).json({ action: 'escalated', keyword: intent.keyword });
  }

  if (intent.type === 'program') {
    const program = intent.program;
    const label = getProgramLabel(program);
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program,
    }).eq('id', existingLead.id);

    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const qualifyParams = hinglish
      ? [label, checkoutUrl, intakeUrl]
      : [label, checkoutUrl, intakeUrl];

    await sendWhatsApp(phone, 'program_qualified', qualifyParams);
    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'received_no_action' });
};
