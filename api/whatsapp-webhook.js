const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const {
  detectMarket,
  maskPhone,
  classifyIntent,
  needsEscalation,
  isOptOut,
  getProgramDetails,
  jsonResponse,
  corsHeaders,
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.senderPhone || body.from || body.waId || '';
    const message = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy(db, phone, message, 'escalation_medical');
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      await db
        .from('messages')
        .update({ status: 'client_reply' })
        .eq('phone', phone)
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(1);
      return res.status(200).json({ action: 'client_reply_logged' });
    }

    if (!existingLead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone,
          name: senderName || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      const welcomeParams = isHinglish
        ? [senderName || 'there']
        : [senderName || 'there'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      console.log(`Ignoring dropped lead ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'dropped_ignored' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    const intent = classifyIntent(message);

    if (intent) {
      const program = getProgramDetails(intent);

      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutSlug}`;
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const params = isHinglish
        ? [senderName || 'there', program.name, `$${program.price}`, checkoutUrl, intakeUrl]
        : [senderName || 'there', program.name, `$${program.price}`, checkoutUrl, intakeUrl];

      await sendWhatsApp(phone, 'program_offer_v1', params);

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'reply_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function notifyMaddy(db, phone, message, reason) {
  const MADDY_PHONE = '+917082478374';

  await db.from('messages').insert({
    phone: MADDY_PHONE,
    direction: 'out',
    body: `ESCALATION [${reason}] from ${maskPhone(phone)}: ${message.slice(0, 200)}`,
    template_name: 'escalation_alert',
    sent_at: new Date().toISOString(),
    status: 'pending',
  });

  try {
    const { sendWhatsApp: sendWA } = require('../lib/whatsapp');
    await sendWA(MADDY_PHONE, 'escalation_alert', [
      maskPhone(phone),
      reason,
      message.slice(0, 100),
    ]);
  } catch (e) {
    console.error('Failed to notify Maddy:', e.message);
  }
}
