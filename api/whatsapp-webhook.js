const { getClient } = require('../lib/supabase');
const { sendRateLimited, sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'transform'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'no gym', 'bodyweight', 'ghar'], program: '6wk_home', label: '6-Week Home' }
];

const OPT_OUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'cancel', 'ruko', 'band karo'];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = body.mobile || body.phone || body.from;
    const text = body.text || body.message || body.body || '';
    const senderName = body.name || body.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const supabase = getClient();
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    await supabase.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (OPT_OUT_KEYWORDS.some(kw => text.toLowerCase().includes(kw))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await notifyMaddy(supabase, 'Escalation keyword detected', {
        phone: maskPhone(phone),
        message: text.slice(0, 200)
      });
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

    if (!existingLead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market
      }).select().single();

      const welcomeParams = { name: senderName || (hinglish ? 'there' : 'there') };
      await sendTemplate(supabase, phone, 'welcome_v1', welcomeParams);

      return res.status(200).json({ action: 'new_lead', lead_id: newLead.id });
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead' });
    }

    if (existingLead.status === 'new') {
      const matched = matchProgram(text);
      if (matched) {
        await supabase.from('leads').update({
          status: 'qualified',
          program_interest: matched.program
        }).eq('id', existingLead.id);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
        const intakeUrl = `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendRateLimited(supabase, phone, 'program_match', {
          name: existingLead.name || 'there',
          program: matched.label,
          checkout_url: checkoutUrl,
          intake_url: intakeUrl
        }, false);

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      await sendRateLimited(supabase, phone, 'clarify_goal', {
        name: existingLead.name || 'there'
      }, false);

      return res.status(200).json({ action: 'awaiting_goal' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
