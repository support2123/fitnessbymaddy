const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./send-whatsapp');
const {
  maskPhone, detectMarket, isHinglish, classifyIntent,
  programLabel, programPrice, jsonResponse, cors
} = require('./lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '917082478374';
const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') { cors(res); return res.status(200).end(); }
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  const body = req.body;
  const phone = body.phone || body.from || body.waId || body.senderPhone;
  const text = body.text || body.message || body.body || '';
  const senderName = body.senderName || body.name || '';

  if (!phone) return jsonResponse(res, 400, { error: 'No phone number' });

  const supabase = getSupabase();
  const cleanPhone = phone.startsWith('+') ? phone : '+' + phone;
  const market = detectMarket(cleanPhone);
  const hinglish = isHinglish(market);

  await supabase.from('messages').insert({
    phone: cleanPhone,
    direction: 'in',
    body: text,
    status: 'received',
  });

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', cleanPhone)
    .single();

  const intent = classifyIntent(text);

  if (intent === 'STOP') {
    if (existingLead) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('id', existingLead.id);
    }
    console.log(`Opt-out: ${maskPhone(cleanPhone)}`);
    return jsonResponse(res, 200, { action: 'opted_out' });
  }

  if (intent === 'ESCALATE') {
    await sendWhatsApp({
      phone: '+' + MADDY_PHONE,
      templateName: 'escalation_alert',
      bodyValues: [maskPhone(cleanPhone), text.substring(0, 200)],
      isClient: true,
    });
    console.log(`Escalation flagged for ${maskPhone(cleanPhone)}: ${text.substring(0, 100)}`);
    return jsonResponse(res, 200, { action: 'escalated' });
  }

  if (!existingLead) {
    const { data: newLead } = await supabase.from('leads').insert({
      phone: cleanPhone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market,
    }).select().single();

    const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
    await sendWhatsApp({
      phone: cleanPhone,
      templateName: welcomeTemplate,
      bodyValues: [senderName || 'there'],
    });

    console.log(`New lead: ${maskPhone(cleanPhone)} market=${market}`);
    return jsonResponse(res, 200, { action: 'new_lead', leadId: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return jsonResponse(res, 200, { action: 'ignored_dropped' });
  }

  await supabase.from('leads').update({
    last_msg_at: new Date().toISOString(),
    name: senderName || existingLead.name,
  }).eq('id', existingLead.id);

  if (intent && existingLead.status === 'new') {
    await supabase.from('leads').update({
      status: 'qualified',
      program_interest: intent,
    }).eq('id', existingLead.id);

    const label = programLabel(intent);
    const price = programPrice(intent);

    let msg;
    if (hinglish) {
      msg = `${label} - perfect choice! Price: $${price}. Yeh raha checkout link:`;
    } else {
      msg = `${label} - great choice! Price: $${price}. Here's your checkout link:`;
    }

    await sendWhatsApp({
      phone: cleanPhone,
      templateName: 'program_offer',
      bodyValues: [
        senderName || 'there',
        label,
        `$${price}`,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
        `${SITE}/intake?lead=${existingLead.id}`,
      ],
    });

    console.log(`Qualified lead ${maskPhone(cleanPhone)} -> ${intent}`);
    return jsonResponse(res, 200, { action: 'qualified', program: intent });
  }

  const { data: existingClient } = await supabase
    .from('clients')
    .select('*')
    .eq('phone', cleanPhone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    console.log(`Active client msg from ${maskPhone(cleanPhone)}: ${text.substring(0, 80)}`);
    return jsonResponse(res, 200, { action: 'client_message', clientId: existingClient.id });
  }

  return jsonResponse(res, 200, { action: 'noted' });
};
