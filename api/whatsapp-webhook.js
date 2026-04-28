const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { detectProgram, needsEscalation, detectMarket, isOptOut, PROGRAM_NAMES, cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return res.status(400).json({ error: 'Invalid body' });
  }

  const phone = body.mobile || body.from || body.senderMobile || '';
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await sendWhatsApp(
      process.env.MADDY_PHONE || '+917082478374',
      'escalation_alert',
      [maskPhone(phone), text.slice(0, 200)]
    );
    return res.status(200).json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);

    await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    });

    const welcomeParams = market === 'IN'
      ? [name || 'there']
      : [name || 'there'];

    await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
    return res.status(200).json({ action: 'new_lead_welcomed' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    const program = detectProgram(text);

    if (program) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[program] || program;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, 'program_match', [
        name || 'there',
        programName,
        checkoutUrl,
        intakeUrl
      ]);

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
};
