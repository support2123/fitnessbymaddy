const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { needsEscalation, detectProgram, detectMarket, isOptOut, notifyMaddy, PROGRAM_NAMES } = require('../lib/escalation');
const { parseBody, json } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method === 'GET') return json(res, 200, { status: 'webhook active' });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  const phone = body.mobile || body.phone || body.from || '';
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return json(res, 400, { error: 'No phone number' });

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message.substring(0, 1000),
    template_name: null,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (isOptOut(message)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
    return json(res, 200, { action: 'opted_out' });
  }

  if (needsEscalation(message)) {
    const market = detectMarket(phone);
    await notifyMaddy(
      'Sensitive keyword detected',
      `Phone: ${phone.substring(0, 4)}XXX...${phone.slice(-3)}\nMessage: ${message.substring(0, 200)}\nMarket: ${market}`
    );
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existingLead) {
    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return json(res, 200, { action: 'ignored_dropped' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return json(res, 200, { action: 'active_client', client_id: existingClient.id });
    }

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const market = detectMarket(phone);
        const programName = PROGRAM_NAMES[program] || program;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_match', [
          name || 'there',
          programName,
          checkoutUrl,
          intakeUrl,
        ]);

        return json(res, 200, { action: 'qualified', program });
      }
    }

    return json(res, 200, { action: 'existing_lead', lead_id: existingLead.id });
  }

  const market = detectMarket(phone);
  const { data: newLead, error } = await db.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.substring(0, 500),
    last_msg_at: new Date().toISOString(),
    market,
    created_at: new Date().toISOString(),
  }).select().single();

  if (error) {
    console.error('Lead insert error:', error.message);
    return json(res, 500, { error: 'Failed to create lead' });
  }

  const isHinglish = market === 'IN';
  const welcomeTemplate = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendWhatsApp(phone, welcomeTemplate, [name || 'there']);

  const program = detectProgram(message);
  if (program) {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program,
    }).eq('id', newLead.id);

    const programName = PROGRAM_NAMES[program] || program;
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${newLead.id}`;

    await sendWhatsApp(phone, 'program_match', [
      name || 'there',
      programName,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return json(res, 200, { action: 'new_lead', lead_id: newLead.id, program });
};
