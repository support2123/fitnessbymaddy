const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./_lib/whatsapp');
const {
  detectMarket, maskPhone, isHinglishMarket,
  needsEscalation, classifyIntent, getProgramInfo,
  jsonResponse, errorResponse,
} = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  const payload = req.body || {};
  const phone = payload.mobile || payload.senderMobile || payload.from;
  const text = payload.text || payload.message || payload.body || '';

  if (!phone) return errorResponse(res, 'No phone number in payload');

  const db = getSupabase();
  const market = detectMarket(phone);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
  });

  if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return jsonResponse(res, { action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await notifyMaddy(
      'Lead needs human review',
      `Phone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 300)}`
    );
    return jsonResponse(res, { action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!existingLead) {
    return await handleNewLead(db, phone, text, market, res);
  }

  if (existingLead.status === 'dropped') {
    return jsonResponse(res, { action: 'ignored_dropped' });
  }

  return await handleReply(db, existingLead, text, market, res);
};

async function handleNewLead(db, phone, text, market, res) {
  const { data: lead } = await db.from('leads').insert({
    phone,
    name: null,
    source: 'whatsapp',
    status: 'new',
    first_msg: text,
    market,
  }).select().single();

  const hinglish = isHinglishMarket(market);

  if (hinglish) {
    await sendWhatsApp(phone, 'welcome_v1', [
      'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
    ]);
  } else {
    await sendWhatsApp(phone, 'welcome_v1', [
      'Hi! Welcome to Fitness by Maddy. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'
    ]);
  }

  return jsonResponse(res, { action: 'new_lead', lead_id: lead.id });
}

async function handleReply(db, lead, text, market, res) {
  const intent = classifyIntent(text);

  await db.from('leads').update({
    last_msg_at: new Date().toISOString(),
  }).eq('id', lead.id);

  if (!intent) {
    return jsonResponse(res, { action: 'no_match', lead_id: lead.id });
  }

  const programInfo = getProgramInfo(intent);
  if (!programInfo) {
    return jsonResponse(res, { action: 'unknown_program' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: programInfo.slug,
  }).eq('id', lead.id);

  const hinglish = isHinglishMarket(market);
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${programInfo.checkoutPath}`;
  const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`;

  if (hinglish) {
    await sendWhatsApp(lead.phone, 'program_match', [
      `${programInfo.name} ($${programInfo.price})`,
      `Checkout: ${checkoutUrl}`,
      `Pehle ye form bhar do: ${intakeUrl}`,
    ]);
  } else {
    await sendWhatsApp(lead.phone, 'program_match', [
      `${programInfo.name} ($${programInfo.price})`,
      `Checkout: ${checkoutUrl}`,
      `Please fill this intake form first: ${intakeUrl}`,
    ]);
  }

  return jsonResponse(res, {
    action: 'qualified',
    lead_id: lead.id,
    program: programInfo.slug,
  });
}
