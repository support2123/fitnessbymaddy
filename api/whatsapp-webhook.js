const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, detectProgram, needsEscalation, isOptOut, maskPhone } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');

const PROGRAM_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  'zoom_trial': '$20 Zoom Trial'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();
  const body = req.body;

  const phone = body.senderPhone || body.from || body.waId;
  const message = body.text || body.message || body.body || '';
  const name = body.senderName || body.pushName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number' });
  }

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    await escalateToMaddy('Keyword trigger in message', { phone, message });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    }).select().single();

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hindi' : 'welcome_v1';
    await sendWhatsApp(phone, welcomeTemplate, [name || 'there']);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  if (existingLead.status === 'new') {
    const program = detectProgram(message);
    if (program) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const link = PROGRAM_LINKS[program];
      const programName = PROGRAM_NAMES[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (market === 'IN') {
        await sendWhatsApp(phone, 'program_offer_hindi', [
          name || 'there',
          programName,
          link,
          intakeLink
        ]);
      } else {
        await sendWhatsApp(phone, 'program_offer', [
          name || 'there',
          programName,
          link,
          intakeLink
        ]);
      }

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'noted' });
};
