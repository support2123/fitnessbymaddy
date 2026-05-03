const { supabase } = require('./lib/supabase');
const { detectMarket, sendTemplate, sendTextMessage, needsEscalation, notifyMaddy } = require('./lib/whatsapp');
const { detectProgram, isOptOut, PROGRAM_NAMES } = require('./lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(`⚠️ Escalation needed\nFrom: ${phone}\nMsg: ${text}`);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await supabase.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_msg_logged' });
    }

    const program = detectProgram(text);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('phone', phone);

      const market = existingLead.market || 'IN';
      const lang = market === 'IN' ? 'hinglish' : 'en';
      const programName = PROGRAM_NAMES[program];

      if (lang === 'hinglish') {
        await sendTextMessage(phone,
          `Great choice! 🔥 ${programName} — yeh program bahut logon ko results de chuka hai.\n\n` +
          `Checkout karo: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\n` +
          `Intake form bhi fill karo taaki Maddy aapke liye plan personalize kar sake:\n` +
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        );
      } else {
        await sendTextMessage(phone,
          `Great choice! 🔥 ${programName} has delivered incredible results.\n\n` +
          `Checkout here: https://fitnessbymaddyy.exlyapp.com/checkout/${program}\n\n` +
          `Also fill your intake form so Maddy can personalise your plan:\n` +
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
