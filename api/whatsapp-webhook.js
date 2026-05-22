const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, logIncoming } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'fat', 'lose weight', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', '40+', 'forty'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', '12wk', 'flagship', 'personalised'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'optout', 'cancel'];

function matchProgram(text) {
  const lower = text.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', endpoint: 'whatsapp-webhook' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile || '';
    const body = payload.message || payload.text || payload.body || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    await logIncoming(phone, body);

    const lower = body.toLowerCase().trim();

    if (STOP_WORDS.some(w => lower === w || lower.includes(w))) {
      const db = getSupabase();
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(body)) {
      await createEscalation({
        sourceType: 'whatsapp',
        phone,
        reason: 'keyword_trigger',
        details: body.slice(0, 500)
      });
    }

    const db = getSupabase();
    const { data: existing } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!existing || existing.length === 0) {
      const market = detectMarket(phone);
      const hinglish = isHinglish(market);

      const { data: lead } = await db.from('leads').insert({
        phone,
        first_msg: body,
        market,
        status: 'new'
      }).select().single();

      const welcomeMsg = hinglish
        ? 'Hi! Maddy\'s team here. Kaun sa goal hai — fat loss, PCOS, strength, ya 40+ fitness? Ya trial pehle try karna hai?'
        : 'Hi! Maddy\'s team here. What\'s your goal — fat loss, PCOS management, strength, or 40+ fitness? Or would you like to try a trial session first?';

      await sendWhatsApp({
        phone,
        templateName: 'welcome_v1',
        body: welcomeMsg,
        params: { templateParams: [] }
      });

      return res.status(200).json({ action: 'new_lead', lead_id: lead?.id });
    }

    const lead = existing[0];

    if (lead.status === 'dropped') {
      return res.status(200).json({ action: 'ignored_dropped' });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);

    if (lead.status === 'new') {
      const match = matchProgram(body);
      if (match) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: match.program
        }).eq('id', lead.id);

        const market = lead.market || detectMarket(phone);
        const hinglish = isHinglish(market);

        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`;

        const msg = hinglish
          ? `Great choice! ${match.label} program perfect rahega. Yahan se start karo:\n\nCheckout: ${checkoutUrl}\n\nAur yeh form bhi fill kar do: ${intakeUrl}`
          : `Great choice! The ${match.label} program is perfect for you. Get started here:\n\nCheckout: ${checkoutUrl}\n\nAlso fill out this form: ${intakeUrl}`;

        await sendWhatsApp({
          phone,
          body: msg,
          isClient: false
        });

        return res.status(200).json({ action: 'qualified', program: match.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
