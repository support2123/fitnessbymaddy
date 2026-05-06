const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, getLanguage } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');
const { qualifyLead } = require('./_lib/qualify');

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const message = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const lang = getLanguage(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const lower = message.toLowerCase().trim();
    if (STOP_WORDS.some(w => lower === w || lower.includes(w))) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy({
        reason: 'Keyword trigger in message',
        phone,
        clientName: name,
        message
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = lang === 'hinglish'
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const match = qualifyLead(message);

      if (match) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
            last_msg_at: new Date().toISOString()
          })
          .eq('phone', phone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.checkoutSlug}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualMsg = lang === 'hinglish'
          ? `Great choice! ${match.name} program ($${match.price}) perfect hai aapke liye.\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
          : `Great choice! The ${match.name} program ($${match.price}) is perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nPlease also fill your intake form: ${intakeUrl}`;

        await sendWhatsApp({
          phone,
          templateName: 'program_match',
          body: qualMsg,
          params: [match.name, String(match.price)]
        });

        return res.status(200).json({ action: 'lead_qualified', program: match.program });
      }

      const fallbackMsg = lang === 'hinglish'
        ? "Thanks for your message! Kya aap fat loss, PCOS, strength, 40+ fitness, ya trial session mein interested ho? Batao toh best program suggest karein."
        : "Thanks for your message! Are you interested in fat loss, PCOS management, strength, 40+ fitness, or a trial session? Let us know so we can suggest the best program.";

      await sendWhatsApp({
        phone,
        templateName: 'clarify_goal',
        body: fallbackMsg,
        params: []
      });

      return res.status(200).json({ action: 'awaiting_clarification' });
    }

    return res.status(200).json({ action: 'existing_lead_updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
