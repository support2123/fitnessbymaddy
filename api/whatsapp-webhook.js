const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendMessage, maskPhone, detectMarket } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');
const { canSendTo, isOptedIn, logMessage } = require('./lib/rate-limit');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'transform': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior',
  '40plus': '40+ Strong',
  '12wk': '12-Week Flagship Program',
  'zoom_trial': 'Zoom Trial Session'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const isHinglish = market === 'IN';

    await logMessage(phone, 'in', message, null);

    if (message.toLowerCase().match(/\b(stop|unsubscribe)\b/)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('keyword_trigger', { phone: maskPhone(phone), message });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const welcomeMsg = isHinglish
        ? 'Hi! Maddy\'s team here 👋 Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here 👋 What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);
      await logMessage(phone, 'out', welcomeMsg, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead_greeted' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const matchedProgram = matchProgram(message);

      if (matchedProgram) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matchedProgram
        }).eq('phone', phone);

        const checkoutLink = PROGRAM_LINKS[matchedProgram];
        const programName = PROGRAM_NAMES[matchedProgram];
        const intakeLink = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        const qualMsg = isHinglish
          ? `Perfect! ${programName} tumhare liye best rahega 💪\n\nCheckout: ${checkoutLink}\n\nSaath mein ye form bhi fill kardo: ${intakeLink}`
          : `Perfect! ${programName} is ideal for you 💪\n\nCheckout: ${checkoutLink}\n\nAlso fill this quick form: ${intakeLink}`;

        if (await canSendTo(phone) || await isOptedIn(phone)) {
          await sendMessage(phone, qualMsg);
          await logMessage(phone, 'out', qualMsg, 'qualification_reply');
        }

        return res.status(200).json({ action: 'qualified', program: matchedProgram });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}
