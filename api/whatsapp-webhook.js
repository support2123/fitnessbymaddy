const { supabase } = require('./_lib/supabase');
const { sendTemplate, canSendTo, maskPhone } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'knee', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', label: '6-Week Home' },
];

const STOP_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.sender;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await supabase.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      status: 'received',
    });

    const lower = text.toLowerCase().trim();
    if (STOP_KEYWORDS.some(kw => lower.includes(kw))) {
      await supabase
        .from('leads')
        .update({ status: 'dropped', last_msg_at: new Date().toISOString() })
        .eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword escalation in WhatsApp message', { phone: maskPhone(phone), message: text.slice(0, 200) });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .single();

    if (existingClient) {
      return res.status(200).json({ action: 'active_client', client_id: existingClient.id });
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'whatsapp',
          status: 'new',
          first_msg: text,
          market,
        })
        .select()
        .single();

      const hinglish = isHinglish(market);
      await sendTemplate(phone, 'welcome_v1', [
        name || (hinglish ? 'there' : 'there'),
      ]);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    await supabase
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    const matched = matchProgram(text);
    if (matched) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: matched.program })
        .eq('id', existingLead.id);

      const hinglish = isHinglish(market);
      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

      if (canSendTo(phone, false)) {
        await sendTemplate(phone, 'program_match', [
          matched.label,
          checkoutUrl,
          intakeUrl,
        ]);
      }

      return res.status(200).json({ action: 'qualified', program: matched.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
