const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { detectMarket, classifyIntent, needsEscalation, isOptOut } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body;
  const phone = payload.phone || payload.from || payload.senderPhone || '';
  const messageBody = payload.message || payload.text || payload.body || '';
  const senderName = payload.name || payload.senderName || '';

  if (!phone) {
    return res.status(400).json({ error: 'No phone number in payload' });
  }

  const db = getSupabase();

  await logMessage(phone, 'in', messageBody, null);

  // Handle opt-out immediately
  if (isOptOut(messageBody)) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Check for escalation triggers
  if (needsEscalation(messageBody)) {
    await db.from('escalations').insert({
      phone,
      reason: 'keyword_trigger',
      message_body: messageBody,
    });

    // Notify Maddy
    try {
      await sendWhatsApp(
        process.env.MADDY_PHONE || '+917082478374',
        'escalation_alert',
        [maskPhone(phone), messageBody.slice(0, 200)]
      );
    } catch (_) { /* best effort */ }

    return res.status(200).json({ action: 'escalated' });
  }

  // Check if this is an existing lead
  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  // Check if already a client
  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .eq('status', 'active')
    .maybeSingle();

  if (existingClient) {
    // Active client messaging in — log and let support handle
    return res.status(200).json({ action: 'client_message_logged' });
  }

  if (!existingLead) {
    // NEW LEAD — Flow A
    const market = detectMarket(phone);
    const { data: newLead } = await db
      .from('leads')
      .insert({
        phone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    // Send welcome template
    try {
      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      await logMessage(phone, 'out', welcomeParams[0], 'welcome_v1');
    } catch (err) {
      console.error(`Welcome msg failed for ${maskPhone(phone)}:`, err.message);
    }

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  // EXISTING LEAD — Flow B (qualification)
  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  // Update last message
  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  const program = classifyIntent(messageBody);
  if (program) {
    await db
      .from('leads')
      .update({ status: 'qualified', program_interest: program })
      .eq('id', existingLead.id);

    const market = existingLead.market || 'GLOBAL';
    const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
    const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

    const msgText = market === 'IN'
      ? `Great choice! Yeh raha aapka checkout link: ${checkoutUrl}\n\nAur please yeh intake form bhi fill karo: ${intakeUrl}`
      : `Great choice! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill out this intake form: ${intakeUrl}`;

    try {
      await sendWhatsApp(phone, 'program_checkout', [msgText]);
      await logMessage(phone, 'out', msgText, 'program_checkout');
    } catch (err) {
      console.error(`Checkout msg failed for ${maskPhone(phone)}:`, err.message);
    }

    return res.status(200).json({ action: 'qualified', program });
  }

  return res.status(200).json({ action: 'message_logged' });
};
