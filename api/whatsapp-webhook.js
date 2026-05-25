const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncomingMessage, detectMarket } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
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
  'flagship': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial',
};

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Flagship',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack',
};

const CHECKOUT_URLS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logIncomingMessage(phone, message);

    const lower = message.toLowerCase().trim();
    if (lower === 'stop' || lower === 'unsubscribe') {
      const db = getSupabase();
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Sensitive keyword detected',
        `Phone: ${phone.slice(0, 3)}XXX...${phone.slice(-3)}\nMessage: ${message.slice(0, 200)}`
      );
    }

    const db = getSupabase();
    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
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
        market,
      }).select().single();

      const isHinglish = market === 'IN';
      const welcomeBody = isHinglish
        ? "Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"
        : "Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?";

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeBody,
        params: [name || 'there'],
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    await db.from('leads').update({
      last_msg_at: new Date().toISOString(),
    }).eq('id', existing.id);

    if (existing.status === 'new' || existing.status === 'qualified') {
      const matched = matchProgram(message);
      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched,
        }).eq('id', existing.id);

        const label = PROGRAM_LABELS[matched];
        const checkoutUrl = CHECKOUT_URLS[matched];
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${existing.id}`;
        const market = existing.market || 'GLOBAL';
        const isHinglish = market === 'IN';

        const qualifyBody = isHinglish
          ? `Great choice! ${label} aapke liye perfect rahega.\n\nCheckout: ${checkoutUrl}\n\nPehle ye intake form bhi fill karo:\n${intakeUrl}`
          : `Great choice! ${label} sounds perfect for you.\n\nCheckout here: ${checkoutUrl}\n\nAlso fill out this quick intake form:\n${intakeUrl}`;

        await sendWhatsApp({
          phone,
          body: qualifyBody,
          templateName: 'qualify_program',
          params: [name || 'there', label, checkoutUrl],
        });

        return res.status(200).json({ action: 'qualified', program: matched });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
