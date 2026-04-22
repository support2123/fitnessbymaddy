const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, notifyMaddy, detectMarket, normalizePhone, maskPhone, checkEscalation, checkOptOut } = require('./_lib/whatsapp');
const { parseBody, cors, json, mapKeywordToProgram, programLabel, programPrice } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const phone = normalizePhone(body.mobile || body.phone || body.from || '');
  const text = (body.message || body.text || body.body || '').trim();
  const name = body.name || body.pushName || null;

  if (!phone || !text) return json(res, 400, { error: 'Missing phone or message' });

  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
  });

  if (checkOptOut(text)) {
    await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return json(res, 200, { action: 'opted_out' });
  }

  const escalationTrigger = checkEscalation(text);
  if (escalationTrigger) {
    await supabase.from('escalations').insert({
      phone,
      reason: escalationTrigger,
      trigger_msg: text,
    });
    await notifyMaddy(
      `Escalation keyword: "${escalationTrigger}"`,
      `From: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`
    );
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: lead } = await supabase
      .from('leads')
      .insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    const isHinglish = market === 'IN';
    const welcomeMsg = isHinglish
      ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?";

    await sendWhatsApp({ phone, body: welcomeMsg, templateName: 'welcome_v1' });
    return json(res, 200, { action: 'new_lead', lead_id: lead?.id });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return json(res, 200, { action: 'ignored_dropped' });
  }

  if (existingLead.status === 'converted') {
    return json(res, 200, { action: 'existing_client' });
  }

  const programKey = mapKeywordToProgram(text);
  if (programKey) {
    await supabase
      .from('leads')
      .update({ status: 'qualified', program_interest: programKey })
      .eq('phone', phone);

    const market = existingLead.market || 'IN';
    const isHinglish = market === 'IN';
    const label = programLabel(programKey);
    const price = programPrice(programKey);
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

    const qualifyMsg = isHinglish
      ? `Great choice! 💪 ${label} ($${price}) perfect hai tere goal ke liye.\n\n` +
        `👉 Checkout: ${checkoutUrl}\n\n` +
        `Payment ke baad ye form bhar dena:\n📋 ${intakeUrl}\n\n` +
        `Koi question ho toh pooch — hum yahaan hain!`
      : `Great choice! 💪 The ${label} ($${price}) is perfect for your goal.\n\n` +
        `👉 Checkout: ${checkoutUrl}\n\n` +
        `After payment, fill out this form:\n📋 ${intakeUrl}\n\n` +
        `Any questions? We're here to help!`;

    await sendWhatsApp({ phone, body: qualifyMsg });
    return json(res, 200, { action: 'qualified', program: programKey });
  }

  return json(res, 200, { action: 'no_match', message: 'No keyword matched' });
};
