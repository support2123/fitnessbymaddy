const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { matchProgram, getCheckoutUrl, getProgramName } = require('../lib/qualify');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const text = payload.text || payload.body || payload.message || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (/^(stop|unsubscribe|optout|opt out)$/i.test(text.trim())) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected', phone, text);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status, created_at')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || undefined
    }).eq('id', existingLead.id);

    const program = matchProgram(text);
    if (program) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program
      }).eq('id', existingLead.id);

      const checkoutUrl = getCheckoutUrl(program);
      const programName = getProgramName(program);
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (hinglish) {
        await sendText(phone,
          `Great choice! ${programName} bilkul sahi hai tere goal ke liye.\n\n` +
          `Checkout: ${checkoutUrl}\n\n` +
          `Aur yeh form bhi fill kar do taaki hum tera program customize kar sake:\n${intakeUrl}`
        );
      } else {
        await sendText(phone,
          `Great choice! ${programName} is perfect for your goals.\n\n` +
          `Checkout here: ${checkoutUrl}\n\n` +
          `Also fill this quick form so we can customise your program:\n${intakeUrl}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'existing_lead_reply' });

  } catch (err) {
    console.error('[whatsapp-webhook]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
