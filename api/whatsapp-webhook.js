const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, sendEscalation, detectMarket, normalizePhone } = require('./lib/whatsapp');
const { handleCors, jsonError, jsonOk, needsEscalation, classifyIntent, PROGRAM_INFO } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  const db = getSupabase();

  const payload = req.body || {};
  const rawPhone = payload.mobile || payload.phone || payload.from || '';
  const phone = normalizePhone(rawPhone);
  const text = (payload.text || payload.message || payload.body || '').trim();
  const senderName = payload.name || payload.pushName || '';

  if (!phone) return jsonError(res, 'No phone number');

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
    sent_at: new Date().toISOString(),
    status: 'received',
  });

  if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return jsonOk(res, { action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await sendEscalation(
      'Medical/Escalation keyword detected',
      `Phone: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}, Msg: ${text.slice(0, 100)}`
    );
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
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    });

    const greeting = market === 'IN'
      ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
      : ['Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

    await sendWhatsApp(phone, 'welcome_v1', greeting, true);
    return jsonOk(res, { action: 'new_lead_greeted' });
  }

  await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

  const { data: existingClient } = await db
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existingClient) {
    return jsonOk(res, { action: 'active_client_message_logged' });
  }

  const intent = classifyIntent(text);

  if (!intent) {
    return jsonOk(res, { action: 'unclassified_reply_logged' });
  }

  const program = PROGRAM_INFO[intent];
  if (!program) {
    return jsonOk(res, { action: 'unclassified_reply_logged' });
  }

  await db.from('leads').update({
    status: 'qualified',
    program_interest: intent,
  }).eq('phone', phone);

  const market = existingLead.market || 'GLOBAL';
  const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent}`;
  const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

  const msgParams = market === 'IN'
    ? [program.name, program.price, checkoutUrl, intakeUrl]
    : [program.name, program.price, checkoutUrl, intakeUrl];

  await sendWhatsApp(phone, 'program_offer', msgParams);

  return jsonOk(res, { action: 'qualified', program: intent });
};
