const { getClient } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { detectMarket, isHinglish } = require('../lib/market');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getClient();
  const whatsapp = { sendTemplate, sendText };

  try {
    const { mobile: phone, text: messageText, name } = req.body;

    if (!phone || !messageText) {
      return res.status(400).json({ error: 'Missing phone or text' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText.substring(0, 1000),
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    const lower = messageText.toLowerCase().trim();

    if (lower === 'stop' || lower === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await notifyMaddy('Sensitive message received', { phone, detail: messageText.substring(0, 200) }, { whatsapp, supabase });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead_ignored' });
      }

      if (existingLead.status === 'new') {
        const match = qualifyLead(messageText);
        if (match) {
          await supabase
            .from('leads')
            .update({ status: 'qualified', program_interest: match.program })
            .eq('id', existingLead.id);

          const market = existingLead.market;
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

          const msg = isHinglish(market)
            ? `Perfect! ${match.label} program tere liye best rahega 💪\n\nYahan se start karo:\n${checkoutUrl}\n\nAur ye intake form bhi fill kardo:\n${intakeUrl}`
            : `Perfect! The ${match.label} program is ideal for your goal 💪\n\nGet started here:\n${checkoutUrl}\n\nPlease also fill out this intake form:\n${intakeUrl}`;

          await sendText(phone, msg, { supabase });
          return res.status(200).json({ action: 'qualified', program: match.program });
        }
      }

      return res.status(200).json({ action: 'existing_lead_updated' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageText.substring(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    const match = qualifyLead(messageText);
    if (match) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: match.program })
        .eq('id', newLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${newLead.id}`;

      const msg = isHinglish(market)
        ? `Hi! Maddy's team here 👋\n\n${match.label} program tere liye perfect hai!\n\nCheckout: ${checkoutUrl}\nIntake form: ${intakeUrl}`
        : `Hi! Maddy's team here 👋\n\nThe ${match.label} program is perfect for you!\n\nCheckout: ${checkoutUrl}\nIntake form: ${intakeUrl}`;

      await sendText(phone, msg, { supabase });
      return res.status(200).json({ action: 'new_lead_qualified', program: match.program });
    }

    await sendTemplate(phone, 'welcome_v1', {
      name: name || 'there',
      templateParams: [name || 'there'],
    }, { supabase, bypassRate: true });

    return res.status(200).json({ action: 'new_lead_welcomed', leadId: newLead.id });
  } catch (err) {
    console.error('whatsapp-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
