const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, detectProgram, isEscalation, isOptOut, maskPhone, PROGRAM_NAMES } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getClient();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.phone || payload.from || '';
    const text = payload.text || payload.body || payload.message || '';
    const senderName = payload.name || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const cleanPhone = phone.replace(/\D/g, '');

    await db.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped', opted_out: true })
        .eq('phone', cleanPhone);
      console.log(`Opt-out: ${maskPhone(cleanPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (isEscalation(text)) {
      await notifyMaddy(
        'Escalation Alert',
        `${maskPhone(cleanPhone)} said: "${text.slice(0, 100)}"`
      );
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', cleanPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .limit(1)
      .single();

    if (existingLead) {
      if (existingLead.opted_out) {
        return res.status(200).json({ action: 'opted_out_lead' });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'new' || existingLead.status === 'dropped') {
        return await handleQualification(res, db, existingLead, text, cleanPhone);
      }

      return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
    }

    const market = detectMarket(cleanPhone);
    const { data: newLead } = await db.from('leads').insert({
      phone: cleanPhone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    }).select().single();

    const welcomeParams = market === 'IN'
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or want to try a trial session first?'];

    await sendTemplate(cleanPhone, 'welcome_v1', welcomeParams);

    console.log(`New lead: ${maskPhone(cleanPhone)} market=${market}`);
    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleQualification(res, db, lead, text, phone) {
  const program = detectProgram(text);

  if (!program) {
    return res.status(200).json({ action: 'no_program_match' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', lead.id);

  const market = lead.market || 'GLOBAL';
  const programName = PROGRAM_NAMES[program] || program;
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${lead.id}`;

  const msg = market === 'IN'
    ? [`${programName} — perfect choice! 💪`, `Checkout: ${checkoutUrl}`, `Intake form: ${intakeUrl}`]
    : [`${programName} — great choice! 💪`, `Checkout: ${checkoutUrl}`, `Intake form: ${intakeUrl}`];

  await sendTemplate(phone, 'checkout_link', msg);

  return res.status(200).json({ action: 'qualified', program });
}
