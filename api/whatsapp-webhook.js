const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const {
  detectMarket, matchProgram, maskPhone, isOptOut,
  checkEscalation, getGreeting, getProgramCheckoutUrl, getProgramName
} = require('../lib/helpers');
const { escalateLead } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender || '';
    const messageBody = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.sender_name || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    if (isOptOut(messageBody)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(messageBody);
    if (escalation.shouldEscalate) {
      await escalateLead(phone, escalation.reason, messageBody);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ action: 'existing_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: messageBody,
          market
        })
        .select()
        .single();

      const greeting = getGreeting(market);
      await sendTemplate(phone, 'welcome_v1', {
        name: name || '',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = matchProgram(messageBody);

      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const checkoutUrl = getProgramCheckoutUrl(program);
        const programName = getProgramName(program);
        const market = existingLead.market;

        let msg;
        if (market === 'IN') {
          msg = `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;
        } else {
          msg = `Great choice! ${programName} is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nAlso fill your intake form: https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;
        }

        await sendText(phone, msg);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
