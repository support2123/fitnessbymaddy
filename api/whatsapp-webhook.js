const { getSupabase } = require('./lib/supabase');
const { sendTemplate, canSendMessage, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    // Log incoming message
    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    // Check opt-out
    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in message', {
        phone: maskPhone(phone),
        details: message.slice(0, 100)
      });
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    // Check if already a client
    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      // Active client messaging — don't auto-respond, log only
      return res.status(200).json({ action: 'client_message_logged' });
    }

    if (!existingLead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      // Send welcome template
      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your fitness goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    // Existing lead replied — FLOW B: Qualification
    await db.from('leads').update({
      last_msg_at: new Date().toISOString()
    }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      // Re-engaged dropped lead
      await db.from('leads').update({ status: 'new' }).eq('phone', phone);
    }

    const qualification = qualifyLead(message);

    if (qualification) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: qualification.programId
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const checkoutUrl = getCheckoutUrl(qualification.checkout);
      const intakeUrl = getIntakeUrl(existingLead.id);

      if (await canSendMessage(phone)) {
        const params = market === 'IN'
          ? [qualification.name, `$${qualification.price}`, checkoutUrl, intakeUrl]
          : [qualification.name, `$${qualification.price}`, checkoutUrl, intakeUrl];

        await sendTemplate(phone, 'program_qualified', params);
      }

      return res.status(200).json({ action: 'qualified', program: qualification.programId });
    }

    // Unqualified reply — general acknowledgment
    if (await canSendMessage(phone)) {
      const market = existingLead.market || 'GLOBAL';
      const params = market === 'IN'
        ? ['Thanks for the reply! Kya aap fat loss, PCOS, strength, ya trial session mein interested ho? Batao toh sahi program suggest karein.']
        : ['Thanks for replying! Are you interested in fat loss, PCOS management, strength training, or a trial session? Let us know so we can recommend the right program.'];

      await sendTemplate(phone, 'followup_qualify', params);
    }

    return res.status(200).json({ action: 'followup_sent' });

  } catch (err) {
    console.error('[WA Webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
