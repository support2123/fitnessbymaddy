const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logInboundMessage, detectMarket, isHinglish, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalate } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const phone = body.mobile || body.waId || body.from || '';
    const message = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number provided' });
    }

    console.log(`Inbound from ${maskPhone(phone)}: ${message.slice(0, 50)}`);

    await logInboundMessage(phone, message);

    if (isOptOut(message)) {
      await handleOptOut(phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalate(phone, 'keyword_trigger', message);
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_reply', clientId: existingClient.id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_action' });
    }

    if (existingLead && (existingLead.status === 'qualified' || existingLead.status === 'converted')) {
      return res.status(200).json({ action: 'already_qualified' });
    }

    if (existingLead && existingLead.status === 'new') {
      const match = qualifyLead(message);
      if (match) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
            last_msg_at: new Date().toISOString()
          })
          .eq('id', existingLead.id);

        const hinglish = isHinglish(phone);
        const checkoutUrl = getCheckoutUrl(match.checkout);
        const intakeUrl = getIntakeUrl(existingLead.id);

        const replyText = hinglish
          ? `Perfect choice! 🔥 ${match.name} program tumhare liye best rahega.\n\n💰 Price: $${match.price}\n\n👉 Checkout: ${checkoutUrl}\n\n📋 Intake form bhi fill kar do: ${intakeUrl}`
          : `Perfect choice! 🔥 The ${match.name} program is ideal for you.\n\n💰 Price: $${match.price}\n\n👉 Checkout: ${checkoutUrl}\n\n📋 Also fill your intake form: ${intakeUrl}`;

        await sendWhatsApp(phone, 'program_recommendation', {
          name: existingLead.name || senderName,
          templateParams: [
            existingLead.name || senderName || 'there',
            match.name,
            `$${match.price}`,
            checkoutUrl,
            intakeUrl
          ]
        }, true);

        return res.status(200).json({ action: 'qualified', program: match.program });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    const hinglish = isHinglish(phone);

    await sendWhatsApp(phone, 'welcome_v1', {
      name: senderName || 'there',
      templateParams: [senderName || 'there']
    }, true);

    return res.status(200).json({ action: 'new_lead_created', leadId: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function handleOptOut(phone) {
  const db = getSupabase();

  await db
    .from('leads')
    .update({ status: 'dropped' })
    .eq('phone', phone);

  await db
    .from('clients')
    .update({ status: 'paused' })
    .eq('phone', phone)
    .eq('status', 'active');
}
