const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, isOptOut, classifyIntent, getCheckoutUrl, getProgramLabel } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.senderMobile || body.from || '';
    const text = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(
        'Lead needs attention',
        `Phone: ${maskPhone(phone)}\nMessage: ${text}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      const lead = existingLead[0];

      if (lead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', lead.id);

      if (lead.status === 'new') {
        const program = classifyIntent(text);
        if (program) {
          await supabase
            .from('leads')
            .update({ status: 'qualified', program_interest: program })
            .eq('id', lead.id);

          const label = getProgramLabel(program, hinglish);
          const checkoutUrl = getCheckoutUrl(program);

          const msg = hinglish
            ? `Great choice! ${label} aapke liye perfect hai. Yahan se start karo:\n${checkoutUrl}\n\nIntake form bhi fill karo taaki hum aapka plan bana sakein:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`
            : `Great choice! ${label} is perfect for you. Get started here:\n${checkoutUrl}\n\nAlso fill out your intake form so we can build your plan:\nhttps://fitnessbymaddy.com/intake?lead=${lead.id}`;

          await sendText(phone, msg);
          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select()
      .single();

    const welcomeMsg = hinglish
      ? `Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendText(phone, welcomeMsg);

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
