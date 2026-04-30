const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, canSendToLead } = require('./lib/whatsapp');
const {
  maskPhone,
  detectMarket,
  isHinglishMarket,
  needsEscalation,
  classifyIntent,
  PROGRAM_NAMES,
  cors,
} = require('./lib/utils');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (/stop|unsubscribe|opt.?out/i.test(text)) {
      await db
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await sendText(
        MADDY_PHONE,
        `🚨 ESCALATION needed\nFrom: ${maskPhone(phone)}\nMsg: "${text.slice(0, 200)}"\nAction required.`
      );
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

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_ignored' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'converted') {
      return res.json({ action: 'already_converted' });
    }

    const intent = classifyIntent(text);
    if (intent) {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: intent })
        .eq('id', existingLead.id);

      const programName = PROGRAM_NAMES[intent] || intent;
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${intent}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (hinglish) {
        await sendText(
          phone,
          `Perfect choice! 🔥 ${programName} aapke liye best rahega.\n\n` +
            `Checkout karo: ${checkoutUrl}\n\n` +
            `Pehle ye form bhi fill kardo taaki hum aapka plan personalize kar sakein: ${intakeUrl}`
        );
      } else {
        await sendText(
          phone,
          `Great choice! 🔥 The ${programName} is perfect for your goals.\n\n` +
            `Checkout here: ${checkoutUrl}\n\n` +
            `Also fill this quick form so we can personalise your plan: ${intakeUrl}`
        );
      }

      return res.json({ action: 'qualified', program: intent });
    }

    if (await canSendToLead(phone)) {
      const replyMsg = hinglish
        ? 'Zaroor! Aap batao — fat loss, PCOS, strength, 40+ fitness, ya pehle trial try karna hai?'
        : 'Sure! What are you looking for — fat loss, PCOS management, strength, 40+ fitness, or try a trial session first?';
      await sendText(phone, replyMsg);
    }

    return res.json({ action: 'replied' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
