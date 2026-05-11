const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { detectMarket, isHinglishMarket } = require('../lib/market');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'shred', 'lean', 'burn', 'fat'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'period', 'irregular'],
  '40plus': ['40', 'menopause', 'joints', 'joint', 'age', '50'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test'],
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-burn-build',
  '6wk_home': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-home',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-flagship',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial',
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const message = (body.message || body.text || body.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (STOP_WORDS.some(w => message.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy(
        'Medical/sensitive keyword detected',
        `Phone: ${maskPhone(phone)} — "${message}"`
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        name: body.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      });

      const templateName = isHinglishMarket(market) ? 'welcome_v1_hi' : 'welcome_v1_en';
      await sendWhatsApp(phone, templateName, [body.name || 'there']);

      return res.json({ action: 'new_lead_welcomed', market });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const matchedProgram = matchProgram(message);
      if (matchedProgram) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matchedProgram,
        }).eq('id', existingLead.id);

        const market = existingLead.market || 'GLOBAL';
        const checkoutLink = CHECKOUT_LINKS[matchedProgram] || CHECKOUT_LINKS['zoom_trial'];
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_checkout', [
          matchedProgram,
          checkoutLink,
          intakeLink,
        ]);

        return res.json({ action: 'qualified', program: matchedProgram });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}
