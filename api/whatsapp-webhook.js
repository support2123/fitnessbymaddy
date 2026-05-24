const { getSupabase } = require('../lib/supabase');
const { sendTemplate, detectMarket, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, escalate, checkOptOut } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const { phone, message, name, senderName } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const contactName = name || senderName || null;
    const market = detectMarket(cleanPhone);

    await db.from('messages').insert({
      phone: cleanPhone,
      direction: 'in',
      body: message || '',
    });

    if (checkOptOut(message)) {
      await db
        .from('leads')
        .update({ status: 'dropped', opted_out: true })
        .eq('phone', cleanPhone);
      return res.json({ action: 'opted_out' });
    }

    const escalationTrigger = needsEscalation(message);
    if (escalationTrigger) {
      await escalate(cleanPhone, escalationTrigger, message);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone: cleanPhone,
        name: contactName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      });

      const greeting = market === 'IN'
        ? 'welcome_v1_hi'
        : 'welcome_v1_en';

      await sendTemplate(cleanPhone, greeting);

      return res.json({ action: 'new_lead', market });
    }

    if (existingLead.opted_out) {
      return res.json({ action: 'opted_out_ignored' });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', cleanPhone);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const program = matchProgram(message);

      if (program) {
        await db
          .from('leads')
          .update({ status: 'qualified', program_interest: program })
          .eq('phone', cleanPhone);

        const programName = PROGRAM_NAMES[program] || program;
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

        if (await canSendMessage(cleanPhone)) {
          const templateName = market === 'IN'
            ? 'program_offer_hi'
            : 'program_offer_en';

          await sendTemplate(cleanPhone, templateName, [
            programName,
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.json({ action: 'qualified', program });
      }
    }

    return res.json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
