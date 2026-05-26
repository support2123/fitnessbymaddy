const supabase = require('../lib/supabase');
const { sendTemplate, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, getEscalationReason, notifyMaddy } = require('../lib/escalation');

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'optout', 'opt out', 'cancel'];

const PROGRAM_KEYWORDS = {
  '6wk_gym': ['fat loss', 'weight loss', 'weight', 'shred', 'burn', 'fat', 'lean', 'cut'],
  'pcos': ['pcos', 'hormonal', 'hormone', 'pcod'],
  '40plus': ['40', '40+', 'menopause', 'joints', 'joint pain', 'senior'],
  '12wk': ['custom', '12 week', '12wk', 'serious', 'flagship', 'personalised', 'personalized'],
  'zoom_trial': ['trial', 'zoom', 'not sure', 'try', 'test', '$20']
};

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': 'Zoom Trial Session'
};

function classifyProgram(message) {
  const lower = message.toLowerCase();
  for (const [program, keywords] of Object.entries(PROGRAM_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return program;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Parse AiSensy webhook payload (handle multiple formats)
    const phone = body.senderPhone || body.waId || body.from || body.phone;
    const message = body.message || body.text || body.body || '';
    const senderName = body.senderName || body.name || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : '+' + phone;
    console.log(`Incoming from ${maskPhone(normalizedPhone)}: ${message.slice(0, 100)}`);

    await logIncoming(normalizedPhone, message);

    // Opt-out check
    if (OPT_OUT_WORDS.some(w => message.toLowerCase().includes(w))) {
      await supabase.from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', normalizedPhone);
      console.log(`Opted out: ${maskPhone(normalizedPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(message)) {
      const reason = getEscalationReason(message);
      await notifyMaddy(normalizedPhone, message, reason);
      console.log(`Escalated: ${maskPhone(normalizedPhone)} — ${reason}`);
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .limit(1)
      .single();

    // Check if active client (clients get routed differently)
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', normalizedPhone)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingClient) {
      // Active client message — just log, don't re-qualify
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const market = detectMarket(normalizedPhone);

    if (!existingLead) {
      // FLOW A: New lead
      const { data: newLead } = await supabase.from('leads').insert({
        phone: normalizedPhone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      // Send welcome template
      const hinglish = isHinglish(market);
      await sendTemplate(
        normalizedPhone,
        'welcome_v1',
        [senderName || 'there'],
        senderName
      );

      console.log(`New lead created: ${maskPhone(normalizedPhone)} (${market})`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    // FLOW B: Lead qualification
    await supabase.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const program = classifyProgram(message);

    if (program) {
      await supabase.from('leads')
        .update({
          status: 'qualified',
          program_interest: program
        })
        .eq('id', existingLead.id);

      const label = PROGRAM_LABELS[program];
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      const hinglish = isHinglish(market);
      await sendTemplate(
        normalizedPhone,
        'program_recommendation',
        [senderName || 'there', label, checkoutUrl, intakeUrl],
        senderName
      );

      console.log(`Lead qualified: ${maskPhone(normalizedPhone)} → ${program}`);
      return res.status(200).json({ action: 'qualified', program });
    }

    return res.status(200).json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
