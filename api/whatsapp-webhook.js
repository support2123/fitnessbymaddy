const { getSupabase } = require('./lib/supabase');
const { sendTemplate, canSendToLead } = require('./lib/whatsapp');
const { escalate } = require('./lib/escalate');
const {
  detectMarket, isHinglishMarket, needsEscalation, isOptOut,
  classifyIntent, PROGRAM_NAMES, cors, parseBody, maskPhone
} = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.mobile || body.phone || body.from;
  const text = body.message || body.text || body.body || '';
  const name = body.name || body.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  const db = getSupabase();

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text
  });

  if (isOptOut(text)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`Opt-out: ${maskPhone(phone)}`);
    return res.json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalate(phone, 'keyword_trigger', text);
    return res.json({ action: 'escalated' });
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const market = detectMarket(phone);
  const hinglish = isHinglishMarket(market);

  if (!existingLead) {
    await db.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      last_msg_at: new Date().toISOString(),
      market
    });

    const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendTemplate(phone, templateName, [name || 'there']);

    console.log(`New lead: ${maskPhone(phone)} market=${market}`);
    return res.json({ action: 'new_lead', market });
  }

  await db.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('phone', phone);

  if (existingLead.status === 'dropped') {
    return res.json({ action: 'dropped_lead_ignored' });
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id, status')
    .eq('phone', phone)
    .eq('status', 'active')
    .single();

  if (existingClient) {
    return res.json({ action: 'active_client', client_id: existingClient.id });
  }

  if (existingLead.status === 'new') {
    const program = classifyIntent(text);

    if (program) {
      await db.from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      const canSend = await canSendToLead(phone);
      if (canSend) {
        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const templateName = hinglish ? 'program_offer_hi' : 'program_offer_en';
        await sendTemplate(phone, templateName, [
          name || 'there',
          programName,
          checkoutUrl,
          intakeUrl
        ]);
      }

      return res.json({ action: 'qualified', program });
    }

    return res.json({ action: 'unclassified_reply' });
  }

  return res.json({ action: 'no_action' });
};
