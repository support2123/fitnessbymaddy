const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { escalateToMaddy, detectEscalationReason } = require('../lib/escalation');
const { detectMarket, isHinglishMarket, classifyIntent, PROGRAM_NAMES, sendJson, sendError, corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  const body = req.body || {};
  const phone = body.mobile || body.phone || body.from || '';
  const message = body.message || body.text || body.body || '';
  const name = body.name || body.pushName || '';

  if (!phone) return sendError(res, 400, 'Missing phone number');

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: message,
    status: 'received',
  });

  const intent = classifyIntent(message);

  if (intent === 'OPTOUT') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return sendJson(res, 200, { action: 'opted_out' });
  }

  if (intent === 'ESCALATE') {
    const reason = detectEscalationReason(message);
    await escalateToMaddy(phone, reason || 'unknown', message);
    return sendJson(res, 200, { action: 'escalated', reason });
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    return sendJson(res, 200, { action: 'active_client', client_id: existingClient.id });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('id, status, created_at')
    .eq('phone', phone)
    .limit(1)
    .single();

  const market = detectMarket(phone);
  const hinglish = isHinglishMarket(market);

  if (!existingLead) {
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      market,
      program_interest: intent,
    }).select().single();

    const welcomeParams = hinglish
      ? [name || 'there']
      : [name || 'there'];

    await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

    if (intent && PROGRAM_NAMES[intent]) {
      await qualifyAndSendLink(db, newLead.id, phone, intent, hinglish);
    }

    return sendJson(res, 200, { action: 'new_lead', lead_id: newLead.id, intent });
  }

  if (existingLead.status === 'dropped') {
    return sendJson(res, 200, { action: 'dropped_lead' });
  }

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
    program_interest: intent || undefined,
  }).eq('id', existingLead.id);

  if (intent && PROGRAM_NAMES[intent]) {
    await qualifyAndSendLink(db, existingLead.id, phone, intent, hinglish);
    return sendJson(res, 200, { action: 'qualified', lead_id: existingLead.id, program: intent });
  }

  return sendJson(res, 200, { action: 'message_logged', lead_id: existingLead.id });
};

async function qualifyAndSendLink(db, leadId, phone, program, hinglish) {
  await db.from('leads').update({
    status: 'qualified',
    program_interest: program,
  }).eq('id', leadId);

  const programName = PROGRAM_NAMES[program];
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${leadId}`;

  const params = hinglish
    ? [programName, checkoutUrl, intakeUrl]
    : [programName, checkoutUrl, intakeUrl];

  await sendWhatsApp(phone, 'program_checkout', params);
}
