const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./_lib/whatsapp');
const { detectMarket, maskPhone, matchProgram, needsEscalation, isOptOut, isHinglish, PROGRAM_NAMES } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    console.log(`Incoming from ${maskPhone(phone)}: ${message.slice(0, 50)}`);

    // Log incoming message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    // Check opt-out
    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    if (needsEscalation(message)) {
      await sendEscalation(`Lead ${maskPhone(phone)} mentioned: "${message.slice(0, 100)}". Needs human review.`);
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      // Update last_msg_at
      await supabase.from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      // Try to qualify based on reply
      if (existingLead.status === 'new') {
        const program = matchProgram(message);
        if (program) {
          await supabase.from('leads')
            .update({
              status: 'qualified',
              program_interest: program,
              last_msg_at: new Date().toISOString()
            })
            .eq('id', existingLead.id);

          const market = existingLead.market;
          const programName = PROGRAM_NAMES[program];
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          const msg = isHinglish(market)
            ? `${programName} — perfect choice! 💪\n\nYeh raha aapka link:\n${checkoutUrl}\n\nPayment ke baad yeh form fill karo:\n${intakeUrl}`
            : `${programName} — great choice! 💪\n\nHere's your checkout link:\n${checkoutUrl}\n\nAfter payment, fill this intake form:\n${intakeUrl}`;

          await sendWhatsApp({ phone, body: msg, templateName: 'program_checkout' });
          return res.status(200).json({ action: 'qualified', program });
        }
      }

      return res.status(200).json({ action: 'updated' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name: name || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market
    }).select().single();

    // Send welcome message
    const welcomeMsg = isHinglish(market)
      ? `Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?`
      : `Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?`;

    await sendWhatsApp({ phone, body: welcomeMsg, templateName: 'welcome_v1' });

    // Schedule nudge (2hr) — this would normally be a delayed job
    // For now, the cron job handles nudges

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseWebhookPayload(body) {
  // AiSensy webhook format
  if (body?.mobile) {
    return {
      phone: '+' + body.mobile,
      message: body.text || body.message || '',
      name: body.name || body.pushName || null
    };
  }
  // Meta Cloud API format (fallback)
  if (body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const contact = body.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      message: msg.text?.body || '',
      name: contact?.profile?.name || null
    };
  }
  // Direct format
  return {
    phone: body?.phone || '',
    message: body?.message || body?.text || '',
    name: body?.name || null
  };
}
