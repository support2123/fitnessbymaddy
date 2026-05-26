const { supabase } = require('./lib/supabase');
const { sendTemplate, sendTextMessage, maskPhone } = require('./lib/whatsapp');
const { detectMarket, detectProgram, needsEscalation, isOptOut, PROGRAM_NAMES, jsonResponse } = require('./lib/helpers');
const { notifyMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.sender;
    const messageText = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageText,
      status: 'received'
    });

    if (isOptOut(messageText)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageText)) {
      await notifyMaddy('Medical/Safety keyword detected', {
        phone,
        clientName: senderName,
        message: messageText.slice(0, 200)
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
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

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! This is Maddy\'s team. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({
        action: 'new_lead',
        lead_id: newLead?.id,
        market
      });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_no_reply' });
    }

    if (existingLead.status === 'new') {
      const program = detectProgram(messageText);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const market = existingLead.market;
        const msg = market === 'IN'
          ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkoutUrl}\n\nIntake form bhi fill karo: ${intakeUrl}`
          : `Great choice! ${programName} is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease also fill out the intake form: ${intakeUrl}`;

        await sendTextMessage(phone, msg);

        return res.status(200).json({
          action: 'qualified',
          program,
          lead_id: existingLead.id
        });
      }

      const market = existingLead.market;
      const followUp = market === 'IN'
        ? 'Koi baat nahi! Mujhe bata do aapka goal kya hai - fat loss, muscle gain, PCOS, ya general fitness? Mai best program suggest karungi.'
        : 'No worries! Tell me your goal - fat loss, muscle gain, PCOS management, or general fitness? I\'ll suggest the best program for you.';
      await sendTextMessage(phone, followUp);

      return res.status(200).json({ action: 'follow_up_sent' });
    }

    const { data: activeClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (activeClient) {
      return res.status(200).json({
        action: 'active_client_message',
        client_id: activeClient.id
      });
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
