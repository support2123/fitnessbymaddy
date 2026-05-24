const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, detectProgramInterest, escalate } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).json({ error: 'Verification failed' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const message = extractMessage(payload);

    if (!message) {
      return res.status(200).json({ ok: true, note: 'No actionable message' });
    }

    const { phone, text, name } = message;
    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text.slice(0, 1000),
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (/^(stop|unsubscribe|cancel)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ ok: true, action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, `Message: "${text.slice(0, 100)}"`);
      await sendText(phone, 'Thanks for sharing that. Maddy will personally review and get back to you shortly.');
      return res.status(200).json({ ok: true, action: 'escalated' });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text.slice(0, 500),
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const greeting = market === 'IN'
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendText(phone, greeting);
      return res.status(200).json({ ok: true, action: 'new_lead_greeted' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ ok: true, action: 'lead_dropped_ignored' });
    }

    const programMatch = detectProgramInterest(text);
    if (programMatch && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: programMatch.program
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const msg = market === 'IN'
        ? `Great choice! ${programMatch.name} aapke liye perfect hai 💪\n\nPayment link: ${checkoutUrl}\n\nSaath hi ye form bhi fill kar do: ${intakeUrl}\n\nQuestions? Just reply here!`
        : `Great choice! ${programMatch.name} is perfect for you 💪\n\nPayment link: ${checkoutUrl}\n\nAlso please fill this form: ${intakeUrl}\n\nQuestions? Just reply here!`;

      await sendText(phone, msg);
      return res.status(200).json({ ok: true, action: 'qualified', program: programMatch.program });
    }

    return res.status(200).json({ ok: true, action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function extractMessage(payload) {
  if (payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts?.[0];
    return {
      phone: '+' + msg.from,
      text: msg.text?.body || msg.button?.text || '',
      name: contact?.profile?.name || null
    };
  }

  if (payload?.phone && payload?.message) {
    return {
      phone: payload.phone.startsWith('+') ? payload.phone : '+' + payload.phone,
      text: payload.message || '',
      name: payload.name || null
    };
  }

  return null;
}
