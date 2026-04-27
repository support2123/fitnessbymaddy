const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy, isOptOut } = require('../lib/escalation');
const { maskPhone } = require('../lib/pii');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'lose': '6wk_gym', 'slim': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': '$20 Zoom Trial'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const payload = req.body;

    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    await logIncoming(phone, message);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in WhatsApp message', {
        phone: maskPhone(phone),
        message
      });
    }

    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existing) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeMsg = isHinglish(market)
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp(phone, welcomeMsg, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existing.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: name || existing.name
    }).eq('id', existing.id);

    if (existing.status === 'new') {
      const program = matchProgram(message);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existing.id);

        const market = existing.market || 'GLOBAL';
        const programName = PROGRAM_NAMES[program];
        const checkout = CHECKOUT_LINKS[program];
        const intakeLink = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

        const qualMsg = isHinglish(market)
          ? `Great choice! ${programName} aapke liye perfect hai.\n\nCheckout: ${checkout}\n\nPehle ye intake form bhar do:\n${intakeLink}`
          : `Great choice! ${programName} is perfect for you.\n\nCheckout: ${checkout}\n\nPlease fill out the intake form first:\n${intakeLink}`;

        await sendWhatsApp(phone, qualMsg, null);
        return res.status(200).json({ action: 'qualified', program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.phone), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
