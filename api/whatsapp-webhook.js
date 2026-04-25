const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy, isOptOut } = require('./lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone', 'period'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Custom' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keys.some(k => lower.includes(k))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const body = req.body || {};
    const phone = body.mobile || body.phone || body.from || '';
    const text = body.message || body.text || body.body || '';
    const senderName = body.name || body.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Sensitive keyword detected in message', {
        phone,
        name: senderName,
        message: text,
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const greeting = market === 'IN'
        ? ["Hi! Maddy's team here. Kaun sa goal hai - fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?"]
        : ["Hi! Maddy's team here. What's your goal - fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?"];

      await sendWhatsApp(phone, 'welcome_v1', greeting);

      return res.json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new' || existingLead.status === 'qualified') {
      const match = matchProgram(text);

      if (match) {
        await db.from('leads')
          .update({
            status: 'qualified',
            program_interest: match.program,
          })
          .eq('id', existingLead.id);

        const market = existingLead.market || 'GLOBAL';
        const intakeLink = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = market === 'IN'
          ? [
              match.label,
              `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`,
              `Pehle ye form fill karo: ${intakeLink}`,
            ]
          : [
              match.label,
              `Checkout: https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`,
              `Please fill this form first: ${intakeLink}`,
            ];

        await sendWhatsApp(phone, 'program_recommendation', msg);

        return res.json({ action: 'qualified', program: match.program });
      }
    }

    return res.json({ action: 'noted' });
  } catch (err) {
    console.error('Webhook error:', maskPhone(req.body?.mobile || ''), err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
