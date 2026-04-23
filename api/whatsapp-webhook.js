const { supabase } = require('./_lib/supabase');
const { maskPhone, detectMarket, classifyIntent, isHinglish, PROGRAM_MAP } = require('./_lib/helpers');
const { canSendToLead, sendTemplate, sendText, notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    const intent = classifyIntent(text);

    if (intent === 'OPTOUT') {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`[WA] Opt-out: ${maskPhone(phone)}`);
      return res.json({ status: 'opted_out' });
    }

    if (intent === 'ESCALATE') {
      await supabase.from('escalations').insert({
        phone, reason: 'keyword_trigger', message_body: text
      });
      await notifyMaddy('Keyword Escalation', `Phone: ${maskPhone(phone)}\nMsg: ${text}`);
      return res.json({ status: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglish(market);
      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      console.log(`[WA] New lead: ${maskPhone(phone)} market=${market}`);
      return res.json({ status: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ status: 'dropped_lead_ignored' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('id', existingLead.id);

    if (intent && PROGRAM_MAP[intent] && existingLead.status === 'new') {
      const program = PROGRAM_MAP[intent];
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program.key
      }).eq('id', existingLead.id);

      const canSend = await canSendToLead(phone);
      if (canSend) {
        const market = existingLead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        const msg = hinglish
          ? `Great choice! 🔥 ${program.name} — $${program.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Great choice! 🔥 ${program.name} — $${program.price}\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nPlease also fill out your intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendText(phone, msg);
      }

      console.log(`[WA] Qualified: ${maskPhone(phone)} → ${program.key}`);
      return res.json({ status: 'qualified', program: program.key });
    }

    return res.json({ status: 'message_logged' });
  } catch (err) {
    console.error('[WA Webhook Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
