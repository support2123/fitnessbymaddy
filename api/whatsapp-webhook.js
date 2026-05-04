const { supabase } = require('../lib/supabase');
const { sendTemplate, canSendToLead, maskPhone } = require('../lib/whatsapp');
const { detectEscalation, handleEscalation } = require('../lib/escalation');
const { detectMarket, isHinglish } = require('../lib/market');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$35', checkout: '6wk-burn' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45', checkout: 'pcos-warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'knee'], program: '40plus', name: '40+ Strong', price: '$50', checkout: '40plus-strong' },
  { keywords: ['custom', '12 week', 'serious', 'personal', 'flagship', 'advanced'], program: '12wk', name: '12-Week Flagship', price: '$200', checkout: '12wk-flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session', price: '$20', checkout: 'zoom-trial' },
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'opt-out', 'cancel'];

function matchProgram(message) {
  const lower = message.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender?.phone;
    const messageBody = payload.message?.text || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'Missing phone number' });

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: messageBody
    });

    // Check opt-out
    const lower = messageBody.toLowerCase().trim();
    if (OPT_OUT_KEYWORDS.some(kw => lower.includes(kw))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped' })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Check escalation
    const escalationTrigger = detectEscalation(messageBody);
    if (escalationTrigger) {
      await handleEscalation(phone, messageBody, escalationTrigger);
    }

    // Check if existing client
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient[0].id });
    }

    // Check if existing lead
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (existingLead && existingLead.length > 0 && existingLead[0].status !== 'dropped') {
      // Existing lead — try to qualify
      const lead = existingLead[0];

      await supabase
        .from('leads')
        .update({ last_msg_at: new Date().toISOString(), first_msg: messageBody })
        .eq('id', lead.id);

      const matched = matchProgram(messageBody);
      if (matched) {
        await supabase
          .from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('id', lead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.checkout}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${lead.id}`;

        if (hinglish) {
          await sendTemplate(phone, 'program_match_hi', [
            matched.name,
            matched.price,
            checkoutUrl,
            intakeUrl
          ]);
        } else {
          await sendTemplate(phone, 'program_match_en', [
            matched.name,
            matched.price,
            checkoutUrl,
            intakeUrl
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      return res.status(200).json({ action: 'existing_lead', lead_id: lead.id });
    }

    // New lead
    const { data: newLead } = await supabase
      .from('leads')
      .insert({
        phone,
        source: 'whatsapp',
        status: 'new',
        first_msg: messageBody,
        last_msg_at: new Date().toISOString(),
        market
      })
      .select('id')
      .single();

    // Send welcome message
    if (hinglish) {
      await sendTemplate(phone, 'welcome_v1_hi', []);
    } else {
      await sendTemplate(phone, 'welcome_v1_en', []);
    }

    // Schedule nudge: 2hr and 24hr handled by nudge-dropped cron
    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
