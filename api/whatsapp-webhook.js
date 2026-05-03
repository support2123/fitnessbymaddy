const { getSupabase } = require('../lib/supabase');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, classifyEscalation } = require('../lib/escalation');
const { canSendMessage, sendTemplate, logMessage, notifyMaddy } = require('../lib/whatsapp');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', 'burn': '6wk_gym',
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
  pcos: 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  zoom_trial: 'Zoom Trial Session',
  zoom_pack: 'Zoom Pack',
};

function routeToProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.phone || payload.from;
    const text = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming WA from ${maskPhone(phone)}: ${text.slice(0, 50)}`);

    await logMessage(phone, 'in', text, null);

    // Opt-out check
    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      const category = classifyEscalation(text);
      await notifyMaddy(
        `${category} escalation`,
        `Phone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`
      );
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const hinglish = isHinglish(market);
      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, welcomeTemplate, [senderName || 'there']);
      await logMessage(phone, 'out', null, welcomeTemplate);

      return res.status(200).json({ action: 'new_lead', lead_id: lead.id });
    }

    // Update last message timestamp
    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // FLOW B: Lead qualification
    if (existingLead.status === 'new') {
      const program = routeToProgram(text);
      if (program) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: program,
        }).eq('id', existingLead.id);

        const canSend = await canSendMessage(phone, false);
        if (canSend) {
          const market = existingLead.market || 'GLOBAL';
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;
          const programName = PROGRAM_NAMES[program] || program;

          const templateName = isHinglish(market) ? 'program_offer_hi' : 'program_offer';
          await sendTemplate(phone, templateName, [
            senderName || 'there',
            programName,
            checkoutUrl,
            intakeUrl,
          ]);
          await logMessage(phone, 'out', null, templateName);
        }

        return res.status(200).json({ action: 'qualified', program });
      }

      // No keyword match — send helpful nudge if rate limit allows
      const canSend = await canSendMessage(phone, false);
      if (canSend) {
        const market = existingLead.market || 'GLOBAL';
        const template = isHinglish(market) ? 'help_choose_hi' : 'help_choose';
        await sendTemplate(phone, template, [senderName || 'there']);
        await logMessage(phone, 'out', null, template);
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    // For qualified/converted leads, just log
    return res.status(200).json({ action: 'message_logged', status: existingLead.status });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
