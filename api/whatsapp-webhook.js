const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { detectMarket, classifyIntent, getProgramForIntent, maskPhone, cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = await parseBody(req);
  const phone = body.mobile || body.phone || body.from;
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const db = getSupabase();
  const market = detectMarket(phone);

  console.log(`[WA-IN] ${maskPhone(phone)}: ${message.slice(0, 50)}`);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const intent = classifyIntent(message);

  if (intent === 'OPT_OUT') {
    if (existingLead) {
      await db.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
    }
    return res.status(200).json({ action: 'opted_out' });
  }

  if (intent === 'ESCALATE' || intent === 'ESCALATE_MEDICAL') {
    await sendWhatsApp({
      phone: process.env.MADDY_PHONE || '+917082478374',
      templateName: 'escalation_alert',
      params: [maskPhone(phone), intent, message.slice(0, 100)],
    });
    return res.status(200).json({ action: 'escalated' });
  }

  if (!existingLead) {
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    await sendWhatsApp({
      phone,
      templateName: 'welcome_v1',
      params: [name || 'there'],
    });

    if (intent !== 'UNKNOWN') {
      const program = getProgramForIntent(intent);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program.program,
        }).eq('id', newLead.id);

        await sendWhatsApp({
          phone,
          templateName: 'program_offer',
          params: [program.name, `$${program.price}`, `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`],
        });
      }
    }

    return res.status(200).json({ action: 'new_lead', id: newLead.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (intent !== 'UNKNOWN' && existingLead.status === 'new') {
    const program = getProgramForIntent(intent);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program.program,
      }).eq('id', existingLead.id);

      await sendWhatsApp({
        phone,
        templateName: 'program_offer',
        params: [program.name, `$${program.price}`, `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`],
      });

      return res.status(200).json({ action: 'qualified', program: program.program });
    }
  }

  return res.status(200).json({ action: 'noted' });
};
