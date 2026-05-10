const { supabase } = require('./lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglish } = require('./lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('./lib/escalation');
const { qualifyLead } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const messageText = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.name || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', messageText, null);

    if (isOptOut(messageText)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await escalateToMaddy('Keyword trigger in lead message', {
        phone: maskPhone(phone),
        message: messageText
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageText,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      const welcomeText = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, { template: 'welcome_v1', params: [senderName || 'there'] });

      return res.json({ ok: true, action: 'new_lead', leadId: newLead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.json({ ok: true, action: 'lead_dropped_ignored' });
    }

    const qualification = qualifyLead(messageText);

    if (qualification && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({
          status: 'qualified',
          program_interest: qualification.program,
          last_msg_at: new Date().toISOString()
        })
        .eq('id', existingLead.id);

      const qualMsg = hinglish
        ? `Great choice! 🔥 "${qualification.label}" aapke liye perfect hai.\n\n👉 Checkout: ${qualification.checkoutUrl}\n\n📝 Intake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
        : `Great choice! 🔥 "${qualification.label}" is perfect for you.\n\n👉 Checkout: ${qualification.checkoutUrl}\n\n📝 Please fill the intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, { text: qualMsg });

      return res.json({ ok: true, action: 'qualified', program: qualification.program });
    }

    return res.json({ ok: true, action: 'existing_lead_updated' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
