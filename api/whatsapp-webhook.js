const { getSupabase } = require('./lib/supabase');
const { sendTemplate, maskPhone } = require('./lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./lib/market');
const { checkEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/notify-maddy');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'burn'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod', 'irregular period'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', '40+', 'over 40'],
  '12wk': ['custom', '12 week', '12-week', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20', 'demo']
};

function classifyIntent(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) return program;
  }
  return null;
}

function getCheckoutUrl(program) {
  const urls = {
    '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
    '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
    'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
    '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
    '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
    'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
    'zoom_pack': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-pack'
  };
  return urls[program] || urls['zoom_trial'];
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Flagship Custom Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Session Pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', service: 'whatsapp-webhook' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || body.waId || '';
    const message = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message
    });

    const esc = checkEscalation(message);

    if (esc.optout) {
      await db.from('leads').upsert({
        phone,
        status: 'dropped',
        last_msg_at: new Date().toISOString()
      }, { onConflict: 'phone' });
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (esc.escalate) {
      await notifyMaddy(
        `Escalation from ${maskPhone(phone)}`,
        `Triggers: ${esc.reasons.join(', ')}\nMessage: ${message.slice(0, 500)}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      });

      const templateName = isHinglishMarket(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || existingLead.name
    }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = classifyIntent(message);

      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('phone', phone);

        const programName = PROGRAM_NAMES[program];
        const checkoutUrl = getCheckoutUrl(program);
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const templateName = isHinglishMarket(market) ? 'program_match_hi' : 'program_match';
        await sendTemplate(phone, templateName, {
          name: senderName || existingLead.name || 'there',
          templateParams: [
            senderName || existingLead.name || 'there',
            programName,
            checkoutUrl,
            intakeUrl
          ]
        });

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
