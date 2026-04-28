const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming, canSendMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalateToMaddy } = require('../lib/escalation');
const { qualifyLead } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logIncoming(phone, text);

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger', phone, text.slice(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (existingLead && existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_no_action' });
    }

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: lead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeTemplate = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const qualification = qualifyLead(text);
      if (qualification) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: qualification.program,
        }).eq('id', existingLead.id);

        const canSend = await canSendMessage(phone);
        if (canSend) {
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          if (isHinglish(market)) {
            await sendTemplate(phone, 'qualified_hi', [
              senderName || 'there',
              qualification.name,
              checkoutUrl,
              intakeUrl,
            ]);
          } else {
            await sendTemplate(phone, 'qualified_en', [
              senderName || 'there',
              qualification.name,
              checkoutUrl,
              intakeUrl,
            ]);
          }
        }

        return res.json({ action: 'qualified', program: qualification.program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
