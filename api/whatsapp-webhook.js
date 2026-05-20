const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead, CHECKOUT_LINKS } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
    });

    if (/^(stop|unsubscribe|opt.?out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', { phone: maskPhone(phone), message: text.slice(0, 200) });
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
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcomeParams = isHinglish(market)
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS support, strength, or 40+ fitness? Or try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead_welcomed', market });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    if (existingLead.status === 'new') {
      const match = qualifyLead(text);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program,
        }).eq('phone', phone);

        const allowed = await canSendMessage(phone);
        if (allowed) {
          const market = existingLead.market || 'GLOBAL';
          const checkoutUrl = CHECKOUT_LINKS[match.program] || '';
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const msg = isHinglish(market)
            ? [`${match.name} program perfect rahega aapke liye! Yahan se start karo: ${checkoutUrl} — Aur intake form bhi fill karo: ${intakeUrl}`]
            : [`${match.name} sounds perfect for you! Get started here: ${checkoutUrl} — Also fill out the intake form: ${intakeUrl}`];

          await sendTemplate(phone, 'program_match', msg);
        }

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
