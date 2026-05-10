const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, programLabel, isOptOut, needsEscalation, parseBody, jsonResp, corsHeaders } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResp(res, 405, { error: 'Method not allowed' });

  const db = getSupabase();
  let body;
  try {
    body = await parseBody(req);
  } catch {
    return jsonResp(res, 400, { error: 'Invalid request body' });
  }

  const phone = body.phone || body.from || body.senderPhone || '';
  const text = body.text || body.message || body.body || '';
  const senderName = body.name || body.senderName || '';

  if (!phone) return jsonResp(res, 400, { error: 'Missing phone number' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return jsonResp(res, 200, { action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy('Keyword trigger in WhatsApp message', {
      phone,
      name: senderName,
      message: text,
    });
    return jsonResp(res, 200, { action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('id, status, program_interest')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    }).select().single();

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, welcomeTemplate, [senderName || 'there']);

    if (newLead) {
      scheduleNudge(db, newLead.id, phone, market);
    }

    return jsonResp(res, 200, { action: 'new_lead', lead_id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return jsonResp(res, 200, { action: 'ignored_dropped' });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const intent = classifyIntent(text);
  if (intent && existingLead.status === 'new') {
    await db.from('leads').update({
      status: 'qualified',
      program_interest: intent,
    }).eq('id', existingLead.id);

    const label = programLabel(intent);
    const market = detectMarket(phone);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const template = market === 'IN' ? 'program_offer_hi' : 'program_offer_en';
    await sendWhatsApp(phone, template, [
      senderName || 'there',
      label,
      checkoutUrl,
      intakeUrl,
    ]);

    return jsonResp(res, 200, { action: 'qualified', program: intent });
  }

  return jsonResp(res, 200, { action: 'message_logged' });
};

async function scheduleNudge(db, leadId, phone, market) {
  // Nudges are handled by the daily cron; we just ensure
  // the lead exists with status=new and the cron picks it up.
}
