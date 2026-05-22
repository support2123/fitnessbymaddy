const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, isHinglish, maskPhone } = require('./lib/whatsapp');
const { checkEscalation, createEscalation } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'over 40': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_INFO = {
  '6wk_gym': { name: '6-Week Burn & Build', price: '$97', checkoutPath: 'shred' },
  '6wk_home': { name: '6-Week Home Shred', price: '$97', checkoutPath: 'shred' },
  '12wk': { name: '12-Week Custom Program', price: '$200', checkoutPath: 'custom' },
  'pcos': { name: 'PCOS Warrior Program', price: '$45', checkoutPath: 'pcos' },
  '40plus': { name: '40+ Strong Program', price: '$50', checkoutPath: '40plus' },
  'zoom_trial': { name: '$20 Zoom Trial', price: '$20', checkoutPath: 'trial' }
};

function routeToProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function isOptOut(message) {
  if (!message) return false;
  const lower = message.toLowerCase().trim();
  return ['stop', 'unsubscribe', 'opt out', 'opt-out', 'leave me alone'].includes(lower);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.waId;
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.pushName || payload.name || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
      status: 'received'
    });

    if (isOptOut(message)) {
      await db.from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationTrigger = checkEscalation(message);
    if (escalationTrigger) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1);

      await createEscalation({
        sourceType: 'whatsapp',
        sourceId: lead?.[0]?.id,
        phone,
        reason: `Keyword detected: ${escalationTrigger}`,
        messageBody: message
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead', leadId: newLead?.id });
    }

    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    if (lead.status === 'new') {
      const programKey = routeToProgram(message);

      if (programKey) {
        const program = PROGRAM_INFO[programKey];

        await db.from('leads')
          .update({ status: 'qualified', program_interest: programKey })
          .eq('id', lead.id);

        const qualifyMsg = hinglish
          ? `Great choice! 🔥 ${program.name} (${program.price}) — yeh program tere liye perfect hai.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}\n\nIntake form bhi fill kar do: https://fitnessbymaddy.com/intake?lead=${lead.id}`
          : `Great choice! 🔥 ${program.name} (${program.price}) — this program is perfect for your goals.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}\n\nPlease also fill out the intake form: https://fitnessbymaddy.com/intake?lead=${lead.id}`;

        await sendWhatsApp({ phone, body: qualifyMsg });

        return res.status(200).json({ action: 'qualified', program: programKey });
      }

      const clarifyMsg = hinglish
        ? "Got it! Thoda aur bata — fat loss chahiye, PCOS help, 40+ fitness, ya pehle ek trial class try karni hai? 💪"
        : "Got it! Tell me more — are you looking for fat loss, PCOS help, 40+ fitness, or would you like to try a trial class first? 💪";

      await sendWhatsApp({ phone, body: clarifyMsg });

      return res.status(200).json({ action: 'clarification_sent' });
    }

    if (lead.status === 'qualified') {
      const { data: existingClient } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .eq('status', 'active')
        .limit(1);

      if (existingClient && existingClient.length > 0) {
        return res.status(200).json({ action: 'active_client_message' });
      }

      const program = PROGRAM_INFO[lead.program_interest] || PROGRAM_INFO['zoom_trial'];
      const reminderMsg = hinglish
        ? `Reminder: ${program.name} ke liye checkout kar lo! 🔗\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}`
        : `Reminder: Complete your checkout for ${program.name}! 🔗\nhttps://fitnessbymaddyy.exlyapp.com/checkout/${program.checkoutPath}`;

      await sendWhatsApp({ phone, body: reminderMsg });

      return res.status(200).json({ action: 'checkout_reminder_sent' });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
