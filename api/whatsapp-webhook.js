const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'burn fat': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint pain': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial',
  'home': '6wk_home', 'home workout': '6wk_home', 'no gym': '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Flagship Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack',
};

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method === 'GET') return res.status(200).json({ status: 'webhook active' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookPayload(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const db = getSupabase();
    const msgLower = (message || '').toLowerCase().trim();

    await db.from('messages').insert({
      phone, direction: 'in', body: message,
    });

    if (OPT_OUT_KEYWORDS.some(kw => msgLower.includes(kw))) {
      await db.from('leads').update({ status: 'dropped', opted_out: true }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Keyword trigger in incoming message',
        `From: ${maskPhone(phone)}\nMessage: ${message}`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone, name: name || null,
        source: 'whatsapp', status: 'new',
        first_msg: message, last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const greeting = market === 'IN'
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Welcome to Fitness by Maddy. What\'s your goal — fat loss, PCOS management, strength, 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp(phone, greeting, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.opted_out) {
      return res.status(200).json({ action: 'ignored_opted_out' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const matchedProgram = matchProgram(msgLower);

      if (matchedProgram) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matchedProgram,
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'IN';
        const programName = PROGRAM_NAMES[matchedProgram] || matchedProgram;

        const checkoutMsg = market === 'IN'
          ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nIntake form bhi fill karo: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`
          : `Great choice! ${programName} is perfect for you.\n\nCheckout: https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}\n\nPlease also fill the intake form: https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        await sendWhatsApp(phone, checkoutMsg);

        return res.status(200).json({ action: 'qualified', program: matchedProgram });
      }

      const market = existingLead.market || 'IN';
      const helpMsg = market === 'IN'
        ? 'Mujhe bataao — kya goal hai? Fat loss, PCOS, 40+ fitness, ya full custom 12-week program? Ya $20 mein trial try karna hai?'
        : 'Tell me more — are you looking for fat loss, PCOS management, 40+ fitness, or a full custom 12-week program? Or try a $20 trial first?';

      await sendWhatsApp(phone, helpMsg);
      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'acknowledged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookPayload(body) {
  if (!body) return {};
  if (body.entry) {
    const changes = body.entry?.[0]?.changes?.[0]?.value;
    const msg = changes?.messages?.[0];
    return {
      phone: msg?.from || '',
      message: msg?.text?.body || '',
      name: changes?.contacts?.[0]?.profile?.name || '',
    };
  }
  return {
    phone: body.phone || body.mobile || body.from || '',
    message: body.message || body.text || body.body || '',
    name: body.name || body.userName || '',
  };
}

function matchProgram(text) {
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (text.includes(keyword)) return program;
  }
  return null;
}
