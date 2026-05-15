const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText, logMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, normalizePhone, routeToProgram, needsEscalation, needsOptOut, isHinglish, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const rawPhone = body.mobile || body.phone || body.from || body.senderPhone;
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!rawPhone) return res.status(400).json({ error: 'No phone number' });

    const phone = normalizePhone(rawPhone);
    const market = detectMarket(phone);

    await logMessage(phone, 'in', message, null);

    if (needsOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(message);
    if (escalationTrigger) {
      await supabase.from('escalations').insert({
        phone,
        trigger_type: escalationTrigger,
        trigger_message: message.slice(0, 500)
      });
      await notifyMaddy(
        'Escalation Required',
        `Lead ${maskPhone(phone)} mentioned "${escalationTrigger}"\nMsg: ${message.slice(0, 200)}`
      );
      return res.status(200).json({ action: 'escalated' });
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
      .select('id, status, program_interest')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString(),
        name: senderName || existingLead.name
      }).eq('id', existingLead.id);

      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const route = routeToProgram(message);
      if (route) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.checkout}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendText(phone,
            `Perfect! 🔥 ${route.name} ($${route.price}) — yeh program bilkul sahi hai tere goal ke liye.\n\n` +
            `Checkout yahan se karo:\n${checkoutUrl}\n\n` +
            `Aur yeh intake form bhi fill kar do:\n${intakeUrl}\n\n` +
            `Questions ho toh pooch!`, false);
        } else {
          await sendText(phone,
            `Great choice! 🔥 ${route.name} ($${route.price}) is perfect for your goals.\n\n` +
            `Complete your checkout here:\n${checkoutUrl}\n\n` +
            `And fill out this quick intake form:\n${intakeUrl}\n\n` +
            `Any questions? Just ask!`, false);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      return res.status(200).json({ action: 'existing_lead', lead_id: existingLead.id });
    }

    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: message.slice(0, 1000),
      last_msg_at: new Date().toISOString(),
      market
    }).select('id').single();

    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1', [
        senderName || 'there',
        'fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
      ]);
    } else {
      await sendTemplate(phone, 'welcome_v1', [
        senderName || 'there',
        'fat loss, PCOS, strength, or 40+ fitness? Or would you like to try a trial session first?'
      ]);
    }

    const route = routeToProgram(message);
    if (route) {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: route.program
      }).eq('id', newLead.id);
    }

    return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
