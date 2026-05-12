const { getSupabase, maskPhone, detectMarket } = require('../lib/supabase');
const { sendWhatsApp, logMessage } = require('../lib/whatsapp');
const { shouldEscalate, createEscalation } = require('../lib/escalation');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
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

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-gym',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = normalizePhone(body.mobile || body.from || body.senderMobile || '');
    const message = (body.message || body.text || body.body || '').trim();
    const senderName = body.name || body.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const sb = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (STOP_WORDS.some(w => message.toLowerCase().includes(w))) {
      await sb.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationKeyword = shouldEscalate(message);

    const { data: existingLead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await sb
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          last_msg_at: new Date().toISOString(),
          market,
        })
        .select()
        .single();

      if (escalationKeyword) {
        await createEscalation('lead', newLead.id, phone, `Keyword: ${escalationKeyword}`, message);
      }

      const welcomeParams = market === 'IN'
        ? ['Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?']
        : ['Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'];

      await sendWhatsApp(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await sb.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (escalationKeyword) {
      await createEscalation('lead', existingLead.id, phone, `Keyword: ${escalationKeyword}`, message);
    }

    if (existingLead.status === 'new') {
      const program = matchProgram(message);
      if (program) {
        await sb.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program] || program;
        const checkoutUrl = CHECKOUT_URLS[program] || '';
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
        const market = existingLead.market || 'GLOBAL';

        const replyParams = market === 'IN'
          ? [`Great choice! ${programName} perfect hai aapke liye. 💪\n\nCheckout: ${checkoutUrl}\n\nPehle ye form fill karo: ${intakeUrl}`]
          : [`Great choice! The ${programName} is perfect for you. 💪\n\nCheckout: ${checkoutUrl}\n\nPlease fill this form first: ${intakeUrl}`];

        await sendWhatsApp(phone, 'program_match', replyParams);

        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'received' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  let phone = raw.replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+') && phone.length >= 10) {
    phone = '+' + phone;
  }
  return phone || null;
}

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}
