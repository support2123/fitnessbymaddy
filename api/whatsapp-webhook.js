const { supabase } = require('../lib/supabase');
const { sendWhatsApp, logIncomingMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'hormone': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
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
  '6wk_gym': {
    name: '6-Week Burn & Build',
    price: '$97',
    checkoutPath: 'shred-challenge'
  },
  'pcos': {
    name: 'PCOS Warrior Program',
    price: '$45',
    checkoutPath: 'pcos-warrior'
  },
  '40plus': {
    name: '40+ Strong Program',
    price: '$50',
    checkoutPath: '40plus-strong'
  },
  '12wk': {
    name: '12-Week Custom Flagship',
    price: '$200',
    checkoutPath: 'custom-12week'
  },
  'zoom_trial': {
    name: 'Zoom Trial Session',
    price: '$20',
    checkoutPath: 'zoom-trial'
  }
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

function routeToProgram(messageBody) {
  const lower = (messageBody || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.waId;
    const messageBody = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

    await logIncomingMessage(normalizedPhone, messageBody);

    if (OPT_OUT_KEYWORDS.some(k => messageBody.toLowerCase().includes(k))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', normalizedPhone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(messageBody);
    if (escalationReason) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', normalizedPhone)
        .single();

      await createEscalation({
        phone: normalizedPhone,
        clientId: client?.id,
        reason: `Keyword detected: ${escalationReason}`,
        messageBody
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    const market = detectMarket(normalizedPhone);
    const hinglish = isHinglish(market);

    if (!existingLead) {
      const { data: lead } = await supabase.from('leads').insert({
        phone: normalizedPhone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeBody = hinglish
        ? "Hi! Maddy's team here \u{1F44B} Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here \u{1F44B} What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone: normalizedPhone,
        templateName: 'welcome_v1',
        params: [senderName || 'there'],
        body: welcomeBody
      });

      return res.status(200).json({ action: 'new_lead', leadId: lead?.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', normalizedPhone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = routeToProgram(messageBody);

      if (program) {
        const info = PROGRAM_INFO[program];
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', normalizedPhone);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${info.checkoutPath}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const qualifyBody = hinglish
          ? `Great choice! \u{1F4AA} ${info.name} (${info.price}) perfect hai tumhare liye.\n\n\u{1F449} Checkout: ${checkoutUrl}\n\u{1F4CB} Intake form bhi fill karo: ${intakeUrl}\n\nKoi doubt? Pooch lo!`
          : `Great choice! \u{1F4AA} The ${info.name} (${info.price}) is perfect for your goals.\n\n\u{1F449} Checkout: ${checkoutUrl}\n\u{1F4CB} Please fill the intake form too: ${intakeUrl}\n\nAny questions? Just ask!`;

        await sendWhatsApp({
          phone: normalizedPhone,
          templateName: 'program_recommendation',
          params: [senderName || 'there', info.name, info.price],
          body: qualifyBody
        });

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (error) {
    console.error('Webhook error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
