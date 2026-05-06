const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('../lib/whatsapp');
const {
  maskPhone, detectMarket, isHinglish, matchProgram,
  isEscalationTrigger, isOptOut, corsHeaders
} = require('../lib/utils');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.waId || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    if (isOptOut(text)) {
      await supabase.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out from ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (isEscalationTrigger(text)) {
      await notifyMaddy(
        'Lead needs human review',
        `Phone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`
      );
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
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      });

      if (isHinglish(market)) {
        await sendTemplate(phone, 'welcome_v1_hi', [senderName || 'there']);
      } else {
        await sendTemplate(phone, 'welcome_v1', [senderName || 'there']);
      }

      console.log(`New lead from ${maskPhone(phone)} (${market})`);
      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new') {
      const program = matchProgram(text);
      if (program) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('phone', phone);

        const market = existingLead.market;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [
            senderName || 'there',
            program,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match', [
            senderName || 'there',
            program,
            checkoutUrl,
            intakeUrl
          ]);
        }

        console.log(`Lead ${maskPhone(phone)} qualified for ${program}`);
        return res.status(200).json({ action: 'qualified', program });
      }
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      if (isEscalationTrigger(text)) {
        return res.status(200).json({ action: 'escalated_to_maddy' });
      }
      return res.status(200).json({ action: 'client_message_logged' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
