const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lose weight'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', 'menopause', 'joints', 'joint pain', '40+', 'forty'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test']
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

  const payload = req.body;
  const phone = payload.mobile || payload.from || payload.sender;
  const messageBody = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.pushName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  // Log incoming message
  await supabase.from('messages').insert({
    phone,
    direction: 'in',
    body: messageBody
  });

  // Check opt-out
  const lowerMsg = messageBody.toLowerCase().trim();
  if (lowerMsg === 'stop' || lowerMsg === 'unsubscribe') {
    await supabase.from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  // Check escalation triggers
  const escalationReason = needsEscalation(messageBody);
  if (escalationReason) {
    const { data: client } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    await createEscalation({
      phone,
      clientId: client?.id,
      reason: escalationReason,
      triggerMessage: messageBody
    });
  }

  // Check if existing lead
  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    // NEW LEAD — Flow A
    const market = detectMarket(phone);
    await supabase.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      last_msg_at: new Date().toISOString(),
      market
    });

    const hinglish = isHinglish(market);

    if (hinglish) {
      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: "Hi! Maddy's team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
      });
    } else {
      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1_en',
        body: "Hi! Maddy's team here 👋 What's your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"
      });
    }

    return res.status(200).json({ action: 'new_lead_greeted', market });
  }

  // EXISTING LEAD — Flow B (Qualification)
  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'lead_dropped_ignored' });
  }

  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'new' || existingLead.status === 'qualified') {
    const program = matchProgram(lowerMsg);

    if (program) {
      await supabase.from('leads')
        .update({
          status: 'qualified',
          program_interest: program
        })
        .eq('id', existingLead.id);

      const market = existingLead.market || 'IN';
      const hinglish = isHinglish(market);
      const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
      const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      let msg;
      if (hinglish) {
        msg = `Perfect choice! 🔥 Yeh raha aapka checkout link:\n${checkoutUrl}\n\nAur yeh form bhi fill kardo taaki program bilkul aapke hisaab se bane:\n${intakeUrl}`;
      } else {
        msg = `Perfect choice! 🔥 Here's your checkout link:\n${checkoutUrl}\n\nAlso fill this quick form so we can customise your program:\n${intakeUrl}`;
      }

      await sendWhatsApp({ phone, body: msg });
      return res.status(200).json({ action: 'qualified', program });
    }

    // Couldn't match — send a clarifying nudge
    const hinglish = isHinglish(existingLead.market || 'IN');
    if (hinglish) {
      await sendWhatsApp({
        phone,
        body: 'Koi baat nahi! Batao — fat loss chahiye, PCOS help, 40+ fitness, ya ek trial session try karni hai? 💪'
      });
    } else {
      await sendWhatsApp({
        phone,
        body: "No worries! Let me know — are you looking for fat loss, PCOS management, 40+ fitness, or would you like to try a trial session? 💪"
      });
    }

    return res.status(200).json({ action: 'clarification_sent' });
  }

  // Already converted — acknowledge
  return res.status(200).json({ action: 'existing_client_message' });
};

function matchProgram(message) {
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => message.includes(kw))) {
      return program;
    }
  }
  return null;
}
