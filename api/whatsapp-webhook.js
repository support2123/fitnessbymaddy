const { supabase } = require('./_lib/supabase');
const { sendTemplate, sendTextMessage, logInboundMessage, canSendMessage } = require('./_lib/whatsapp');
const { detectMarket, getLanguage } = require('./_lib/market');
const { needsEscalation, isOptOut, createEscalation } = require('./_lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'weight loss': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack',
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.phone || body.from || body.waId || body.sender;
    const messageText = body.text || body.message || body.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logInboundMessage(phone, messageText);

    if (isOptOut(messageText)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = needsEscalation(messageText);
    if (escalationKeyword) {
      await createEscalation(phone, escalationKeyword, messageText);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        first_msg: messageText,
        market,
        status: 'new',
        source: 'whatsapp',
      }).select().single();

      const lang = getLanguage(market);
      if (lang === 'hinglish') {
        await sendTemplate(phone, 'welcome_v1', []);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', []);
      }

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    const program = matchProgram(messageText);
    if (program && existingLead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: program,
      }).eq('id', existingLead.id);

      const lang = getLanguage(existingLead.market);
      const programName = PROGRAM_NAMES[program];
      const checkoutLink = CHECKOUT_LINKS[program];
      const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      if (lang === 'hinglish') {
        await sendTextMessage(phone,
          `Great choice! 🔥 ${programName} — perfect hai tere liye.\n\n` +
          `Payment link: ${checkoutLink}\n\n` +
          `Aur ye intake form bhi bhar de taaki Maddy tera plan customize kar sake:\n${intakeLink}`
        );
      } else {
        await sendTextMessage(phone,
          `Great choice! 🔥 ${programName} is perfect for you.\n\n` +
          `Payment link: ${checkoutLink}\n\n` +
          `Also fill out this intake form so Maddy can customise your plan:\n${intakeLink}`
        );
      }

      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
