const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { qualifyLead } = require('../lib/qualify');
const { shouldEscalate, notifyMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.senderPhone || body.waId || body.from;
    const message = body.text || body.message || body.body || '';
    const senderName = body.senderName || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      return res.status(200).json({ action: 'opted_out' });
    }

    if (shouldEscalate(message)) {
      await notifyMaddy('Keyword escalation from lead', {
        phone,
        name: senderName,
        message: message.slice(0, 200),
      });
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
        first_msg: message,
        market,
        status: 'new',
      });

      const welcomeParams = isHinglish(market)
        ? ["Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or want to try a trial session first?"];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    const match = qualifyLead(message);
    if (match) {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: match.program,
      }).eq('phone', phone);

      const market = existingLead.market || detectMarket(phone);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msgParams = isHinglish(market)
        ? [`${match.name} — yeh program tere liye perfect hai! Price: $${match.price}\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form fill kar: ${intakeUrl}`]
        : [`${match.name} — this program is perfect for you! Price: $${match.price}\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`];

      await sendWhatsApp(phone, 'program_recommendation', msgParams);
      return res.status(200).json({ action: 'qualified', program: match.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
