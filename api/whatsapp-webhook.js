const supabase = require('./_lib/supabase');
const { sendTemplate, sendText, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket, maskPhone } = require('./_lib/market');
const { checkEscalation, checkOptOut } = require('./_lib/escalation');

const PROGRAM_ROUTES = [
  { keys: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint pain', 'over 40', '40+'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', '12wk', 'serious', 'flagship', 'personali'], program: '12wk', label: '12-Week Custom' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keys: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', label: '6-Week Home' },
];

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keys.some(k => lower.includes(k))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from || '';
    const message = body.message || body.text || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    console.log(`Incoming WA from ${maskPhone(phone)}`);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (checkOptOut(message)) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalation = checkEscalation(message);
    if (escalation.escalate) {
      await notifyMaddy(
        'Lead/Client Escalation',
        `Phone: ${maskPhone(phone)}\nMessage: ${message}\nReason: ${escalation.reason}`
      );
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const market = detectMarket(phone);
    const hinglish = isHinglishMarket(market);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name: senderName,
          source: 'whatsapp',
          status: 'new',
          first_msg: message,
          market,
        })
        .select()
        .single();

      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', {
          name: senderName || 'there',
          templateParams: [senderName || 'there'],
        });
      } else {
        await sendTemplate(phone, 'welcome_v1_en', {
          name: senderName || 'there',
          templateParams: [senderName || 'there'],
        });
      }

      return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString(), name: senderName || existingLead.name })
      .eq('id', existingLead.id);

    const programMatch = matchProgram(message);
    if (programMatch && existingLead.status === 'new') {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: programMatch.program })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (hinglish) {
        await sendTemplate(phone, 'program_matched', {
          name: existingLead.name || 'there',
          templateParams: [
            existingLead.name || 'there',
            programMatch.label,
            checkoutUrl,
            intakeUrl,
          ],
        });
      } else {
        await sendTemplate(phone, 'program_matched_en', {
          name: existingLead.name || 'there',
          templateParams: [
            existingLead.name || 'there',
            programMatch.label,
            checkoutUrl,
            intakeUrl,
          ],
        });
      }

      return res.status(200).json({ action: 'qualified', program: programMatch.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
