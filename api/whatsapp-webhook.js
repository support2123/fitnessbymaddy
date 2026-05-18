const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncomingMessage, detectMarket, checkEscalation, notifyMaddy } = require('./_lib/whatsapp');
const { matchProgram, PROGRAMS } = require('./_lib/constants');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const messageBody = payload.text || payload.message || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    await logIncomingMessage(phone, messageBody);

    const lower = messageBody.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationHits = checkEscalation(messageBody);
    if (escalationHits.length > 0) {
      await notifyMaddy(
        'Escalation Required',
        `Lead ${phone.slice(-4)} mentioned: ${escalationHits.join(', ')}. Message: "${messageBody.slice(0, 100)}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    if (!existingLead || existingLead.length === 0) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      await sendWhatsApp(phone, 'welcome_v1', {
        name: payload.name || 'there',
        templateParams: [payload.name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    const lead = existingLead[0];
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_message_logged' });
    }

    if (lead.status === 'new') {
      const programKey = matchProgram(messageBody);
      if (programKey) {
        const program = PROGRAMS[programKey];
        await db.from('leads')
          .update({ status: 'qualified', program_interest: programKey })
          .eq('id', lead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

        const market = lead.market || detectMarket(phone);
        if (market === 'IN') {
          await sendWhatsApp(phone, 'program_offer_hi', {
            name: lead.name || 'there',
            templateParams: [
              lead.name || 'there',
              program.name,
              `$${program.price}`,
              checkoutUrl,
              intakeUrl
            ]
          });
        } else {
          await sendWhatsApp(phone, 'program_offer_en', {
            name: lead.name || 'there',
            templateParams: [
              lead.name || 'there',
              program.name,
              `$${program.price}`,
              checkoutUrl,
              intakeUrl
            ]
          });
        }

        return res.status(200).json({ action: 'qualified', program: programKey });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
