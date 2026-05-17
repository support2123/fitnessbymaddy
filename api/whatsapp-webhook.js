const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish, classifyIntent, PROGRAM_DETAILS, maskPhone } = require('../lib/utils');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await logMessage(phone, 'in', text, null);

    const intent = classifyIntent(text);

    if (intent === 'OPT_OUT') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      const msg = hinglish
        ? 'Aapko aur messages nahi aayenge. Agar kabhi wapas aana ho, toh message kar dena.'
        : 'You have been unsubscribed. If you ever want to restart, just message us.';
      await sendText(phone, msg);
      return res.json({ action: 'opted_out' });
    }

    if (intent === 'ESCALATE' || intent === 'ESCALATE_MEDICAL') {
      await escalateToMaddy(intent, phone, text);
      const msg = hinglish
        ? 'Maddy ki team aapko jaldi contact karegi. Aap safe hain.'
        : 'Maddy\'s team will reach out to you shortly. You are in good hands.';
      await sendText(phone, msg);
      return res.json({ action: 'escalated' });
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
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      await sendTemplate(phone, 'welcome_v1', [
        name || (hinglish ? 'Friend' : 'there'),
      ]);

      return res.json({ action: 'new_lead', phone: maskPhone(phone) });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (intent && PROGRAM_DETAILS[intent]) {
      const program = PROGRAM_DETAILS[intent];
      await db.from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutSlug}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = hinglish
        ? `${program.name} — perfect choice! Price: $${program.price}\n\nCheckout: ${checkoutUrl}\n\nPehle yeh form bhar do: ${intakeUrl}`
        : `Great choice — ${program.name}! Price: $${program.price}\n\nCheckout here: ${checkoutUrl}\n\nPlease fill this intake form first: ${intakeUrl}`;

      await sendText(phone, msg);
      return res.json({ action: 'qualified', program: intent });
    }

    if (existingLead.status === 'new') {
      const msg = hinglish
        ? 'Batao — fat loss, PCOS, strength, ya 40+ fitness? Ya pehle trial try karna hai?'
        : 'Tell me — are you looking for fat loss, PCOS support, strength, or 40+ fitness? Or would you like to try a trial first?';
      await sendText(phone, msg);
    }

    return res.json({ action: 'replied' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
