const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, classifyIntent, programMeta, isHinglish, maskPhone } = require('../lib/helpers');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }
  if (req.method !== 'POST') return res.status(405).end();

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, text);

    const intent = classifyIntent(text);

    if (intent === 'OPTOUT') {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await escalateToMaddy('Flagged keyword in message', {
        phone,
        name: senderName,
        message: text,
      });
      const market = detectMarket(phone);
      const reply = isHinglish(market)
        ? 'Maddy aapko jaldi hi personally reply karengi. Aap safe hands mein ho.'
        : "Maddy will personally get back to you shortly. You're in safe hands.";
      await sendWhatsApp(phone, reply);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcome = isHinglish(market)
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";
      await sendWhatsApp(phone, welcome, 'welcome_v1');
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (intent && programMeta(intent)) {
      const program = programMeta(intent);
      const market = existingLead.market || detectMarket(phone);

      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: program.slug })
        .eq('phone', phone);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutSlug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      let msg;
      if (isHinglish(market)) {
        msg =
          `${program.name} - perfect choice!\n\n` +
          `Price: $${program.price} (one-time)\n` +
          `Duration: ${program.weeks} weeks\n\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Payment ke baad ye form bhi fill karo taaki hum aapka plan bana sakein:\n${intakeUrl}`;
      } else {
        msg =
          `${program.name} - great choice!\n\n` +
          `Price: $${program.price} (one-time)\n` +
          `Duration: ${program.weeks} weeks\n\n` +
          `Checkout here: ${checkoutUrl}\n\n` +
          `After payment, fill this form so we can build your plan:\n${intakeUrl}`;
      }

      await sendWhatsApp(phone, msg, 'program_offer');
      return res.status(200).json({ action: 'qualified', program: program.slug });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('webhook error:', maskPhone(req.body?.senderPhone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
