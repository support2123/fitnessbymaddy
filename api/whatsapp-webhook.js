const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, logInbound, notifyMaddy } = require('./_lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./_lib/market');
const { needsEscalation, classifyEscalation } = require('./_lib/escalation');

const PROGRAM_MAP = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12-week', 'serious', 'flagship'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: '$20 Zoom Trial' }
];

const OPT_OUT = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const entry of PROGRAM_MAP) {
    if (entry.keywords.some(kw => lower.includes(kw))) return entry;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.waId;
    const text = payload.text || payload.body || payload.message || '';
    const name = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    await logInbound(phone, text);

    const lower = (text || '').toLowerCase().trim();

    // Opt-out check
    if (OPT_OUT.some(kw => lower.includes(kw))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    // Escalation check
    if (needsEscalation(text)) {
      const category = classifyEscalation(text);
      await notifyMaddy(
        `Escalation (${category})`,
        `Phone: ${maskPhone(phone)}\nMessage: ${text.slice(0, 200)}`
      );
      return res.status(200).json({ action: 'escalated', category });
    }

    // Check if existing lead
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Check if existing client
    const { data: existingClient } = await db
      .from('clients')
      .select('*')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1)
      .single();

    // Active client messaging — route to Maddy if complex
    if (existingClient) {
      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('phone', phone);
      return res.status(200).json({ action: 'client_message_logged' });
    }

    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    // New lead
    if (!existingLead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = hinglish
        ? { name: name || 'there', templateParams: [name || 'there'] }
        : { name: name || 'there', templateParams: [name || 'there'] };

      await sendTemplate(phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    // Existing lead replied — qualify
    if (existingLead.status === 'new' || existingLead.status === 'dropped') {
      const matched = matchProgram(text);

      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program,
          last_msg_at: new Date().toISOString()
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        const msg = hinglish
          ? [name || 'there', matched.label, checkoutUrl, intakeUrl]
          : [name || 'there', matched.label, checkoutUrl, intakeUrl];

        await sendTemplate(phone, 'program_checkout', {
          name: name || 'there',
          templateParams: msg
        });

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      // Unrecognized reply — update last_msg_at
      await db.from('leads').update({
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      return res.status(200).json({ action: 'unmatched_reply' });
    }

    return res.status(200).json({ action: 'no_action' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
