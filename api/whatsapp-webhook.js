const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'slim': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Custom Training',
  'zoom_trial': 'Zoom Trial Session'
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.phone || payload.from;
    const messageBody = payload.text || payload.message || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    const lowerMsg = messageBody.toLowerCase().trim();
    if (OPT_OUT_KEYWORDS.some(kw => lowerMsg === kw || lowerMsg === kw.toUpperCase())) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(messageBody)) {
      const { data: client } = await supabase
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .single();

      await createEscalation({
        phone,
        clientId: client?.id,
        reason: 'Keyword escalation triggered',
        messageBody
      });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await supabase.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      });

      const welcomeMsg = hinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: []
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = matchProgram(messageBody);

      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', phone);

        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const qualifyMsg = hinglish
          ? `Great choice! ${programName} aapke liye perfect hai.\n\nPayment link: ${checkoutUrl}\n\nIntake form bhi fill karo (program start karne se pehle zaroori hai): ${intakeUrl}`
          : `Great choice! ${programName} is perfect for you.\n\nPayment link: ${checkoutUrl}\n\nPlease also fill out the intake form (required before program start): ${intakeUrl}`;

        await sendWhatsApp({
          phone,
          body: qualifyMsg,
          isClient: false
        });

        return res.status(200).json({ action: 'lead_qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
