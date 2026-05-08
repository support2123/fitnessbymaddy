const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { needsEscalation, detectEscalationType, escalateToMaddy } = require('../lib/escalation');
const { detectMarket, getWelcomeMessage, getNudgeMessage } = require('../lib/market');
const { qualifyLead, getCheckoutUrl, getIntakeUrl } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.phone || body.senderPhone || body.from;
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    await logIncoming(phone, message);

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      const type = detectEscalationType(message);
      const { data: client } = await db.from('clients').select('name').eq('phone', phone).single();
      await escalateToMaddy(phone, client?.name || senderName, type, message);
      await sendWhatsApp(phone, 'escalation_ack', { name: senderName || 'there' },
        "Thanks for sharing that. Maddy will personally review this and get back to you shortly. 🙏");
      return res.status(200).json({ action: 'escalated', type });
    }

    const { data: existingLead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select().single();

      const welcomeMsg = getWelcomeMessage(market);
      await sendWhatsApp(phone, 'welcome_v1', { name: senderName || 'there' }, welcomeMsg);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const match = qualifyLead(message);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('phone', phone);

        const market = existingLead.market || detectMarket(phone);
        const checkoutUrl = getCheckoutUrl(match.checkoutSlug);
        const intakeUrl = getIntakeUrl(existingLead.id);

        let replyMsg;
        if (market === 'IN') {
          replyMsg = `Great choice! 💪 ${match.name} — yeh program bahut results deta hai.\n\n` +
            `💰 Price: $${match.price}\n` +
            `🔗 Checkout: ${checkoutUrl}\n\n` +
            `Saath mein yeh intake form bhi fill karo taaki Maddy tumhare liye customize kar sake:\n📋 ${intakeUrl}`;
        } else {
          replyMsg = `Great choice! 💪 The ${match.name} has helped hundreds achieve amazing results.\n\n` +
            `💰 Price: $${match.price}\n` +
            `🔗 Checkout: ${checkoutUrl}\n\n` +
            `Also fill out this intake form so Maddy can customize your plan:\n📋 ${intakeUrl}`;
        }

        await sendWhatsApp(phone, 'program_recommendation', {
          name: existingLead.name || senderName || 'there',
          templateParams: [match.name, String(match.price)]
        }, replyMsg);

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'received', status: existingLead.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
