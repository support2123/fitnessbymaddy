const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy, isOptOut } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const messageBody = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    await logIncomingMessage(phone, messageBody);

    if (isOptOut(messageBody)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      await escalateToMaddy({ reason: 'keyword_trigger', phone, message: messageBody });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const hinglish = isHinglish(market);

      await db.from('leads').insert({
        phone,
        first_msg: messageBody,
        market,
        status: 'new'
      });

      const welcomeBody = hinglish
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeBody,
        params: []
      });

      return res.status(200).json({ action: 'new_lead_greeted', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const match = qualifyLead(messageBody);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('id', existingLead.id);

        const market = existingLead.market;
        const hinglish = isHinglish(market);

        const checkoutMsg = hinglish
          ? `Great choice! ${match.label} program ($${match.price}) ke liye yahan se checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nAur intake form bhi fill karo: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          : `Great choice! Check out the ${match.label} program ($${match.price}) here: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nAlso fill out the intake form: https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp({
          phone,
          body: checkoutMsg
        });

        return res.status(200).json({ action: 'qualified', program: match.program });
      }

      const hinglish = isHinglish(existingLead.market);
      const nudgeMsg = hinglish
        ? 'Koi specific goal batao toh hum best program suggest kar sakte hain! Fat loss, PCOS, 40+, ya ek trial session?'
        : 'Tell us your specific goal and we\'ll suggest the best program! Fat loss, PCOS, 40+, or a trial session?';

      await sendWhatsApp({ phone, body: nudgeMsg });

      return res.status(200).json({ action: 'asked_for_goal' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
