const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { escalateIfNeeded, detectOptOut } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keys: ['fat loss', 'weight', 'shred', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keys: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keys: ['40', 'menopause', 'joints', 'joint', 'knee'], program: '40plus', label: '40+ Strong' },
  { keys: ['custom', '12 week', 'serious', 'transform', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keys: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body || {};
    const phone = body.phone || body.from || body.senderPhone || '';
    const text = body.text || body.message || body.body || '';
    const name = body.name || body.senderName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    if (detectOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.json({ action: 'opted_out' });
    }

    await escalateIfNeeded(phone, text, 'WhatsApp message');

    const { data: existing } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existing) {
      const { data: lead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      }).select().single();

      const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
      await sendWhatsApp({
        phone,
        templateName: welcomeTemplate,
        params: [name || 'there'],
      });

      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existing.id);

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existing.status === 'new') {
      const matched = matchProgram(text);
      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program,
        }).eq('id', existing.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existing.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existing.id}`;

        if (hinglish) {
          await sendWhatsApp({
            phone,
            templateName: 'program_match_hi',
            params: [matched.label, checkoutUrl, intakeUrl],
          });
        } else {
          await sendWhatsApp({
            phone,
            templateName: 'program_match',
            params: [matched.label, checkoutUrl, intakeUrl],
          });
        }

        return res.json({ action: 'qualified', program: matched.program });
      }

      const nudgeTemplate = hinglish ? 'ask_goal_hi' : 'ask_goal';
      await sendWhatsApp({
        phone,
        templateName: nudgeTemplate,
        params: [name || 'there'],
      });

      return res.json({ action: 'asked_goal' });
    }

    return res.json({ action: 'no_action', status: existing.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keys.some(k => lower.includes(k))) return entry;
  }
  return null;
}
