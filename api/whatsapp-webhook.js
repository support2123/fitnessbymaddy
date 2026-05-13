const { supabase } = require('../lib/supabase');
const { sendTemplate, checkRateLimit, logMessage } = require('../lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('../lib/market');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'lose weight': '6wk_gym', 'burn': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'pcod': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', '40+': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior ($45)',
  '40plus': '40+ Strong ($50)',
  '12wk': '12-Week Flagship ($200)',
  'zoom_trial': '$20 Zoom Trial'
};

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'opt-out'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = body.mobile || body.from || body.waId || '';
    const message = (body.text || body.message || body.body || '').trim();
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await logMessage(phone, 'in', message);

    // Opt-out check
    if (OPT_OUT_WORDS.some(w => message.toLowerCase().includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(message)) {
      await notifyMaddy('Keyword escalation triggered', { phone: maskPhone(phone), name: senderName, message });
      return res.status(200).json({ action: 'escalated' });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lead = existingLead && existingLead[0];

    if (!lead) {
      // FLOW A: New lead
      const market = detectMarket(phone);
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const hinglish = isHinglishMarket(market);
      await sendTemplate(phone, 'welcome_v1', [
        senderName || 'there'
      ]);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // Update last message
    await supabase.from('leads').update({
      last_msg_at: new Date().toISOString(),
      name: senderName || lead.name
    }).eq('id', lead.id);

    // FLOW B: Lead qualification — match keywords
    const lowerMsg = message.toLowerCase();
    let matchedProgram = null;
    for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
      if (lowerMsg.includes(keyword)) {
        matchedProgram = program;
        break;
      }
    }

    if (matchedProgram && lead.status === 'new') {
      await supabase.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram
      }).eq('id', lead.id);

      const rateLimited = await checkRateLimit(phone);
      if (!rateLimited) {
        const hinglish = isHinglishMarket(lead.market);
        const programName = PROGRAM_NAMES[matchedProgram];

        await sendTemplate(phone, 'program_offer', [
          lead.name || 'there',
          programName,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${matchedProgram}`,
          `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
