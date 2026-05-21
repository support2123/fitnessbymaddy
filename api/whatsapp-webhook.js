const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, normalizePhone, needsEscalation, detectProgram, programLabel, isOptOut, handleCors } = require('../lib/helpers');
const { escalate } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.from || payload.senderPhone || '');
    const text = (payload.message || payload.text || payload.body || '').trim();
    const name = payload.name || payload.senderName || '';

    if (!phone || !text) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (isOptOut(text)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate('Keyword trigger in message', phone, text.slice(0, 200));
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', [name || 'there']);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: name || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      const program = detectProgram(text);
      if (program) {
        await supabase.from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = existingLead.market || detectMarket(phone);
        const label = programLabel(program);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendText(phone,
            `Great choice! ${label} aapke liye perfect hai.\n\n` +
            `Checkout: ${checkoutUrl}\n\n` +
            `Pehle ye quick form bhar do toh Maddy aapka plan aur better bana sakti hai:\n${intakeUrl}`
          );
        } else {
          await sendText(phone,
            `Great choice! ${label} is perfect for you.\n\n` +
            `Checkout: ${checkoutUrl}\n\n` +
            `Fill out this quick form so Maddy can build your plan:\n${intakeUrl}`
          );
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    if (existingLead.status === 'converted') {
      const { data: client } = await supabase
        .from('clients')
        .select('*')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1)
        .single();

      if (client) {
        return res.status(200).json({ action: 'active_client_message', client_id: client.id });
      }
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
