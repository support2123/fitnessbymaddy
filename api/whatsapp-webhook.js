const { getClient } = require('../lib/supabase');
const { sendTemplate, canSendToLead } = require('../lib/whatsapp');
const {
  maskPhone,
  detectMarket,
  isHinglish,
  classifyIntent,
  programCheckoutUrl,
  programName,
  cors,
  parseBody,
} = require('../lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const phone = body.phone || body.from || body.sender || body.mobile;
  const text = body.text || body.message || body.body || '';

  if (!phone) {
    return res.status(400).json({ error: 'Missing phone' });
  }

  const db = getClient();
  const market = detectMarket(phone);
  const hinglish = isHinglish(market);

  console.log(`[WA-IN] ${maskPhone(phone)}: ${text.slice(0, 80)}`);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: text,
  });

  const intent = classifyIntent(text);

  // Opt-out handling
  if (intent === 'OPTOUT') {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    console.log(`[OPTOUT] ${maskPhone(phone)} opted out`);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Escalation handling — notify Maddy
  if (intent === 'ESCALATE') {
    await sendTemplate(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', [
      maskPhone(phone),
      text.slice(0, 200),
    ]);
    console.log(`[ESCALATE] ${maskPhone(phone)}: ${text.slice(0, 100)}`);
    return res.status(200).json({ action: 'escalated' });
  }

  // Check if existing lead
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (existingLead) {
    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    // If lead already qualified or converted, skip auto-flow
    if (existingLead.status === 'converted') {
      return res.status(200).json({ action: 'existing_client' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    // Classify and route
    if (intent && !['OPTOUT', 'ESCALATE'].includes(intent)) {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', existingLead.id);

      const allowed = await canSendToLead(phone);
      if (!allowed) {
        return res.status(200).json({ action: 'rate_limited' });
      }

      const checkoutUrl = programCheckoutUrl(intent);
      const name = programName(intent);
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendTemplate(phone, 'program_match', [
        existingLead.name || 'there',
        name,
        checkoutUrl,
        intakeUrl,
      ]);

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'existing_lead_no_intent' });
  }

  // New lead — insert and send welcome
  const { data: newLead, error: insertErr } = await db
    .from('leads')
    .insert({
      phone,
      name: body.name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: text,
      market,
    })
    .select()
    .single();

  if (insertErr) {
    console.error('[LEAD-INSERT]', insertErr.message);
    return res.status(500).json({ error: 'Failed to create lead' });
  }

  // Send welcome template
  const welcomeMsg = hinglish
    ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
    : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial first?";

  await sendTemplate(phone, 'welcome_v1', [welcomeMsg]);

  // If the first message itself has intent, qualify immediately
  if (intent) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: intent })
      .eq('id', newLead.id);

    const checkoutUrl = programCheckoutUrl(intent);
    const name = programName(intent);
    const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${newLead.id}`;

    await sendTemplate(phone, 'program_match', [
      body.name || 'there',
      name,
      checkoutUrl,
      intakeUrl,
    ]);
  }

  return res.status(200).json({ action: 'new_lead', id: newLead.id });
};
