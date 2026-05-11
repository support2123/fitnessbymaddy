const { getSupabase } = require('./_lib/supabase');
const { detectMarket, sendTemplate, sendTextMessage, logMessage, maskPhone } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy, classifyIntent, PROGRAM_LABELS } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword escalation triggered', {
        phone: maskPhone(phone),
        message: text.substring(0, 200),
        clientName: name || 'Unknown'
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, program, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = market === 'IN'
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial first?";

      await sendTemplate(phone, 'welcome_v1', {
        name: name || 'there',
        templateParams: [welcomeMsg]
      });

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const intent = classifyIntent(text);

    if (intent && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: intent
      }).eq('id', existingLead.id);

      const programName = PROGRAM_LABELS[intent] || intent;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const qualifyMsg = market === 'IN'
        ? `Great choice! ${programName} aapke liye perfect hai. Checkout karo: ${checkoutUrl} Aur apni details bharo: ${intakeUrl}`
        : `Great choice! The ${programName} is perfect for you. Checkout here: ${checkoutUrl} And fill in your details: ${intakeUrl}`;

      await sendTextMessage(phone, qualifyMsg, false);

      return res.status(200).json({ action: 'qualified', program: intent });
    }

    return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^+\d]/g, '');
  if (cleaned && !cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}
