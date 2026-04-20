const { supabase } = require('../lib/supabase');
const { sendTemplate, logIncoming, canSendToLead, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, buildEscalationAlert } = require('../lib/escalation');
const { maskPhone } = require('../lib/pii');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'fat', 'lose'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age', '40+', 'forty'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'flagship', 'transform'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'unsure', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
];

const OPT_OUT_WORDS = ['stop', 'unsubscribe', 'opt out', 'cancel', 'leave me alone'];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.from || body.senderMobile;
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    await logIncoming(normalizedPhone, text);

    // Opt-out check
    if (OPT_OUT_WORDS.some(w => text.toLowerCase().includes(w))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', normalizedPhone);
      console.log(`Opt-out: ${maskPhone(normalizedPhone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    const esc = needsEscalation(text);
    if (esc.escalate) {
      await notifyMaddy(buildEscalationAlert(maskPhone(normalizedPhone), text, esc.reasons));
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (existingLead) {
      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString() })
        .eq('id', existingLead.id);

      // If already qualified or converted, don't re-process
      if (existingLead.status === 'converted') {
        return res.status(200).json({ action: 'existing_client' });
      }

      // Try to qualify based on reply
      if (existingLead.status === 'new') {
        const matched = matchProgram(text);
        if (matched) {
          await supabase
            .from('leads')
            .update({
              status: 'qualified',
              program_interest: matched.program,
              last_msg_at: new Date().toISOString()
            })
            .eq('id', existingLead.id);

          const market = detectMarket(normalizedPhone);
          const hinglish = isHinglish(market);

          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          await sendTemplate(normalizedPhone, 'program_offer', [
            senderName || 'there',
            matched.name,
            matched.price,
            checkoutUrl,
            intakeUrl
          ]);

          return res.status(200).json({ action: 'qualified', program: matched.program });
        }
      }

      return res.status(200).json({ action: 'updated' });
    }

    // New lead
    const market = detectMarket(normalizedPhone);
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone: normalizedPhone,
        name: senderName || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      })
      .select()
      .single();

    // Send welcome message
    await sendTemplate(normalizedPhone, 'welcome_v1', [senderName || 'there']);

    // Schedule nudge: 2hr and 24hr handled by cron/nudge-dropped

    // Try immediate qualification if message contains program keywords
    const matched = matchProgram(text);
    if (matched) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', newLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${newLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${newLead.id}`;

      if (await canSendToLead(normalizedPhone)) {
        await sendTemplate(normalizedPhone, 'program_offer', [
          senderName || 'there',
          matched.name,
          matched.price,
          checkoutUrl,
          intakeUrl
        ]);
      }
    }

    console.log(`New lead: ${maskPhone(normalizedPhone)}, market: ${market}`);
    return res.status(200).json({ action: 'new_lead', id: newLead.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
