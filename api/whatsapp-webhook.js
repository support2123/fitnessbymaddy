const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, needsEscalation, isOptOut, maskPhone } = require('./lib/whatsapp');
const { escalate } = require('./lib/escalate');

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'periods', 'irregular'],
  '40plus': ['40', 'forty', 'menopause', 'joints', 'joint pain', '40+', 'over 40'],
  '12wk': ['custom', '12 week', 'serious', 'personalised', 'personalized', 'flagship'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', 'sample', '$20']
};

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return program;
  }
  return null;
}

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Home Shred',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text
    });

    if (isOptOut(text)) {
      await db.from('leads').upsert(
        { phone, status: 'dropped', last_msg_at: new Date().toISOString() },
        { onConflict: 'phone' }
      );
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'keyword_trigger', text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      await db.from('leads').insert({
        phone,
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        status: 'new'
      });

      await sendTemplate(phone, 'welcome_v1', []);

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const program = matchProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program
        }).eq('id', existingLead.id);

        const programName = PROGRAM_NAMES[program] || program;

        await sendTemplate(phone, 'program_match', [
          programName,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
          `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
        ]);

        return res.status(200).json({ action: 'qualified', program });
      }

      await sendTemplate(phone, 'clarify_goal', []);
      return res.status(200).json({ action: 'asked_for_goal' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
