const { supabase } = require('../lib/supabase');
const { sendTemplate, sendText } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/mask-phone');

const PROGRAM_MAP = {
  'fat loss': '6wk_gym',
  'weight': '6wk_gym',
  'shred': '6wk_gym',
  'lose': '6wk_gym',
  'slim': '6wk_gym',
  'pcos': 'pcos',
  'hormonal': 'pcos',
  'pcod': 'pcos',
  '40': '40plus',
  'menopause': '40plus',
  'joints': '40plus',
  'joint': '40plus',
  'custom': '12wk',
  '12 week': '12wk',
  'serious': '12wk',
  'personalised': '12wk',
  'personalized': '12wk',
  'trial': 'zoom_trial',
  'zoom': 'zoom_trial',
  'not sure': 'zoom_trial',
  'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Program',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': 'Zoom Trial Session',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': '$97',
  '6wk_home': '$97',
  '12wk': '$200',
  'pcos': '$45',
  '40plus': '$50',
  'zoom_trial': '$20',
  'zoom_pack': '$150'
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_MAP)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'whatsapp webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    console.log(`Incoming WA from ${maskPhone(phone)}: ${text.slice(0, 100)}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received'
    });

    // Opt-out handling
    const lowerText = text.toLowerCase().trim();
    if (lowerText === 'stop' || lowerText === 'unsubscribe') {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text.slice(0, 200));
    }

    // Check if this is an existing client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client_reply', client_id: existingClient.id });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    if (!existingLead || existingLead.length === 0) {
      // FLOW A: New lead
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: payload.name || null,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          last_msg_at: new Date().toISOString(),
          market
        })
        .select()
        .single();

      await sendTemplate(phone, 'welcome_v1', [
        hinglish
          ? 'Hi! Maddy\'s team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
          : 'Hi! Welcome to Fitness by Maddy. What\'s your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?'
      ]);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    // FLOW B: Existing lead replied — qualify
    const lead = existingLead[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped', lead_id: lead.id });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', lead.id);

    const matchedProgram = matchProgram(text);

    if (matchedProgram) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matchedProgram })
        .eq('id', lead.id);

      const programName = PROGRAM_NAMES[matchedProgram];
      const price = PROGRAM_PRICES[matchedProgram];

      const checkoutMsg = hinglish
        ? `Great choice! ${programName} (${price}) ke liye yeh checkout link use karo:`
        : `Great choice! Here's the checkout link for ${programName} (${price}):`;

      const intakeMsg = hinglish
        ? 'Aur yeh form bhi fill karo taaki hum tumhara program personalise kar sakein:'
        : 'Also, please fill out this intake form so we can personalise your program:';

      await sendText(phone, [
        checkoutMsg,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
        '',
        intakeMsg,
        `https://www.fitnessbymaddy.com/intake.html?lead=${lead.id}`
      ].join('\n'), false);

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }

    // No match — send helpful follow-up
    const helpMsg = hinglish
      ? 'Koi baat nahi! Bata do kya goal hai:\n- Fat loss / weight loss\n- PCOS / hormonal\n- 40+ fitness\n- 12-week custom program\n- Trial session ($20)'
      : 'No worries! Just let us know your goal:\n- Fat loss / weight loss\n- PCOS / hormonal support\n- 40+ fitness\n- 12-week custom program\n- Trial session ($20)';

    await sendText(phone, helpMsg);

    return res.status(200).json({ action: 'follow_up_sent' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
