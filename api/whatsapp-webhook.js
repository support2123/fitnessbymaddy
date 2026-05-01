const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, programLabel, jsonResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const db = getSupabase();
  const body = req.body || {};

  const phone = body.phone || body.sender || body.from;
  const text = body.text || body.message || body.body || '';
  const name = body.name || body.senderName || null;

  if (!phone) return jsonResponse(res, { error: 'No phone number' }, 400);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return jsonResponse(res, { action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy(
      'Lead needs human review',
      `Phone: ${maskPhone(phone)}\nMessage: "${text.slice(0, 200)}"`
    );
    return jsonResponse(res, { action: 'escalated' });
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
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    }).select().single();

    const welcomeParams = market === 'IN'
      ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Welcome to Fitness by Maddy. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a $20 trial first?'];

    await sendTemplate(phone, 'welcome_v1', welcomeParams);
    return jsonResponse(res, { action: 'new_lead', lead_id: lead?.id });
  }

  if (existingLead.status === 'dropped') {
    return jsonResponse(res, { action: 'ignored_dropped' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

  const program = detectProgram(text);
  if (program && existingLead.status === 'new') {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: program,
    }).eq('id', existingLead.id);

    const label = programLabel(program);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const market = existingLead.market;
    const msg = market === 'IN'
      ? [`Great choice! ${label} aapke liye perfect hai. Yahan se start karo:`, checkoutUrl, `Intake form bhi fill kar do: ${intakeUrl}`]
      : [`Great choice! ${label} is perfect for you. Get started here:`, checkoutUrl, `Also fill the intake form: ${intakeUrl}`];

    await sendTemplate(phone, 'program_qualified', msg);
    return jsonResponse(res, { action: 'qualified', program });
  }

  return jsonResponse(res, { action: 'message_logged' });
};
