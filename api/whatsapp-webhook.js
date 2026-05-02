const supabase = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { checkEscalation, isOptOut } = require('../lib/escalation');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lean'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'over 40', 'above 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'demo'],
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.from || payload.senderPhone || payload.waId || '';
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.userName || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    // Log incoming message
    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    // Check opt-out
    if (isOptOut(text)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation triggers
    const escalationTriggers = checkEscalation(text);
    if (escalationTriggers) {
      await notifyMaddy(
        'Escalation Required',
        `Phone: ${maskPhone(phone)} | Triggers: ${escalationTriggers.join(', ')} | Message: ${text.slice(0, 200)}`
      );
    }

    // Check if existing client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      // Active client messaging — log and acknowledge
      return res.status(200).json({ action: 'client_message_logged', client_id: existingClient.id });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (existingLead) {
      // Existing lead — qualify based on keywords
      if (existingLead.status === 'dropped') {
        return res.status(200).json({ action: 'lead_dropped_ignored' });
      }

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      const program = matchProgram(text);
      if (program) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('id', existingLead.id);

        const market = existingLead.market || 'GLOBAL';
        const checkoutUrl = CHECKOUT_URLS[program] || CHECKOUT_URLS['zoom_trial'];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        if (isHinglish(market)) {
          await sendTemplate(phone, 'program_match_hi', [
            getProgramNameHi(program),
            checkoutUrl,
            intakeUrl,
          ], senderName);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            getProgramName(program),
            checkoutUrl,
            intakeUrl,
          ], senderName);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      return res.status(200).json({ action: 'reply_logged' });
    }

    // New lead
    const market = detectMarket(phone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      })
      .select()
      .single();

    // Send welcome template
    if (isHinglish(market)) {
      await sendTemplate(phone, 'welcome_v1_hi', [senderName || 'there'], senderName);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', [senderName || 'there'], senderName);
    }

    // Schedule nudge (2hr and 24hr handled by cron/nudge-dropped)
    return res.status(200).json({
      action: 'new_lead_created',
      lead_id: newLead?.id,
      market,
    });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return program;
  }
  return null;
}

function getProgramName(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior Program ($45)',
    '40plus': '40+ Strong Program ($50)',
    '12wk': '12-Week Flagship Program ($200)',
    'zoom_trial': 'Zoom Trial Session ($20)',
  };
  return names[program] || program;
}

function getProgramNameHi(program) {
  const names = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    'pcos': 'PCOS Warrior Program ($45)',
    '40plus': '40+ Strong Program ($50)',
    '12wk': '12-Week Flagship Program ($200)',
    'zoom_trial': 'Zoom Trial Session ($20)',
  };
  return names[program] || program;
}
