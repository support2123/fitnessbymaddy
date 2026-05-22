const { supabase } = require('./lib/supabase');
const { sendWhatsApp, logInboundMessage } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, notifyMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym',
  weight: '6wk_gym',
  shred: '6wk_gym',
  slim: '6wk_gym',
  lose: '6wk_gym',
  pcos: 'pcos',
  hormonal: 'pcos',
  '40': '40plus',
  menopause: '40plus',
  joints: '40plus',
  custom: '12wk',
  '12 week': '12wk',
  serious: '12wk',
  flagship: '12wk',
  trial: 'zoom_trial',
  zoom: 'zoom_trial',
  'not sure': 'zoom_trial',
  try: 'zoom_trial',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  zoom_trial: '$20 Zoom Trial',
};

const PROGRAM_PRICES = {
  '6wk_gym': '$97',
  pcos: '$45',
  '40plus': '$50',
  '12wk': '$200',
  zoom_trial: '$20',
};

function detectProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function getCheckoutUrl(program, leadId) {
  return `https://fitnessbymaddyy.exlyapp.com/checkout/${leadId}`;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);

    if (!phone || !message) {
      return res.status(400).json({ error: 'Missing phone or message' });
    }

    await logInboundMessage(phone, message);

    const lowerMsg = message.toLowerCase().trim();
    if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await notifyMaddy('Escalation keyword detected in WhatsApp message', {
        phone: maskPhone(phone),
        message: message.slice(0, 200),
      }, sendWhatsApp);
      return res.status(200).json({ action: 'escalated' });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market,
        })
        .select()
        .single();

      const welcomeMsg = isHinglish(market)
        ? "Hi! Maddy's team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = detectProgram(message);
      if (program) {
        const market = existingLead.market || detectMarket(phone);
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program];
        const price = PROGRAM_PRICES[program];
        const checkoutUrl = getCheckoutUrl(program, existingLead.id);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyMsg = isHinglish(market)
          ? `Great choice! ${programName} (${price}) perfect hai tere liye.\n\nCheckout: ${checkoutUrl}\n\nPehle ye intake form bhar do: ${intakeUrl}`
          : `Great choice! ${programName} (${price}) is perfect for you.\n\nCheckout: ${checkoutUrl}\n\nPlease fill this intake form first: ${intakeUrl}`;

        await sendWhatsApp(phone, qualifyMsg);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};

  if (body.phone && body.message) {
    return { phone: body.phone, message: body.message, name: body.name };
  }

  if (body.entry) {
    try {
      const change = body.entry[0]?.changes?.[0]?.value;
      const msg = change?.messages?.[0];
      const contact = change?.contacts?.[0];
      return {
        phone: msg?.from ? `+${msg.from}` : null,
        message: msg?.text?.body || '',
        name: contact?.profile?.name || null,
      };
    } catch {
      return {};
    }
  }

  if (body.destination && body.message_text) {
    return {
      phone: body.sender_phone || body.mobile,
      message: body.message_text,
      name: body.sender_name,
    };
  }

  return {};
}
