const { getSupabase } = require('../lib/supabase');
const { sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, isOptOut, escalate } = require('../lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'burn'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keys: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keys: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Custom', price: '$200' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'demo'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
];

function matchProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const p of PROGRAM_MAP) {
    if (p.keys.some((k) => lower.includes(k))) return p;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender?.phone;
    const message = payload.message || payload.text || payload.body || '';
    const name = payload.name || payload.sender?.name || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: message,
    });

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    const escalationReason = needsEscalation(message);
    if (escalationReason) {
      await escalate(phone, escalationReason, message);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: message,
        market,
      });

      await sendTemplate(phone, 'welcome_v1', [name || 'there']);

      return res.status(200).json({ action: 'new_lead', market });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'new') {
      const matched = matchProgram(message);

      if (matched) {
        await db.from('leads')
          .update({ status: 'qualified', program_interest: matched.program })
          .eq('phone', phone);

        const allowed = await canSendMessage(phone);
        if (allowed) {
          const hinglish = isHinglish(market);
          const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
          const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

          await sendTemplate(phone, 'program_match', [
            name || 'there',
            matched.name,
            matched.price,
            checkoutUrl,
            intakeUrl,
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      const allowed = await canSendMessage(phone);
      if (allowed) {
        await sendTemplate(phone, 'nudge_trial', [name || 'there']);
      }

      return res.status(200).json({ action: 'nudged' });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
