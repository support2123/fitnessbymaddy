const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const {
  detectMarket,
  detectProgram,
  needsEscalation,
  isOptOut,
  programLabel,
  jsonResponse,
  errorResponse,
} = require('../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';
const SITE = 'https://fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.senderPhone || body.from || body.waId;
    const text = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getClient();

    await logMessage(phone, 'in', text, null);

    if (isOptOut(text)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendTemplate(MADDY_PHONE, 'escalation_alert', [
        senderName || phone,
        text.substring(0, 200),
      ]);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const greeting =
        market === 'IN'
          ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
          : 'Hi! Maddy\'s team here 👋 What\'s your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendText(phone, greeting);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const program = detectProgram(text);

    if (program) {
      await db
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: program,
        })
        .eq('id', existingLead.id);

      const market = existingLead.market || detectMarket(phone);
      const label = programLabel(program);
      const intakeUrl = `${SITE}/intake.html?lead=${existingLead.id}`;

      const msg =
        market === 'IN'
          ? `Great choice! 🔥 ${label} program perfect rahega tere liye.\n\n👉 Checkout: https://fitnessbymaddyy.exlyapp.com/checkout\n\n📋 Ye intake form bhi fill kar do: ${intakeUrl}\n\nKoi doubt ho toh pooch!`
          : `Great choice! 🔥 The ${label} program is perfect for you.\n\n👉 Checkout: https://fitnessbymaddyy.exlyapp.com/checkout\n\n📋 Please fill out this intake form: ${intakeUrl}\n\nAny questions? Just ask!`;

      await sendText(phone, msg);

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'received', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
