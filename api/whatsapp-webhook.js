const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { classifyLead, getCheckoutUrl } = require('../lib/classify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.waId || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await logMessage(phone, 'in', text, null, 'received');

    if (/\b(stop|unsubscribe|opt.?out)\b/i.test(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Incoming message flagged', { phone: maskPhone(phone), text: text.substring(0, 300) });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.substring(0, 1000),
        market,
      });

      const welcomeParams = isHinglish(market)
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.json({ action: 'new_lead_welcomed', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const classification = classifyLead(text);

    if (classification && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: classification.program,
      }).eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(classification.program);
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msgParams = isHinglish(market)
        ? [`${classification.label} — perfect choice! Yeh raha checkout link: ${checkoutUrl}\n\nPehle yeh form bhi fill kar do: ${intakeUrl}`]
        : [`${classification.label} — great choice! Here's your checkout link: ${checkoutUrl}\n\nPlease also fill this form: ${intakeUrl}`];

      await sendWhatsApp(phone, 'program_qualified', msgParams);

      return res.json({ action: 'qualified', program: classification.program });
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
