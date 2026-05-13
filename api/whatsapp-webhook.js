const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { detectMarket, isHinglish } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', '40+'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', '12wk', 'serious', 'flagship'], program: '12wk', label: '12-Week Flagship' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' },
  { keywords: ['home', 'ghar', 'no gym', 'bodyweight'], program: '6wk_home', label: '6-Week Home' }
];

function routeProgram(message) {
  if (!message) return null;
  const lower = message.toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    for (const kw of route.keywords) {
      if (lower.includes(kw)) return route;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.phone || payload.waId || payload.from;
    const incomingMsg = payload.text || payload.message || payload.body || '';
    const senderName = payload.name || payload.pushName || null;

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: incomingMsg,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'optout'];
    if (stopWords.some(w => incomingMsg.toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    const esc = needsEscalation(incomingMsg);
    if (esc.needed) {
      await escalateToMaddy(`Keyword: "${esc.trigger}"`, {
        phone,
        clientName: senderName,
        details: incomingMsg.slice(0, 200)
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const market = detectMarket(phone);

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: senderName,
        source: 'whatsapp',
        status: 'new',
        first_msg: incomingMsg,
        last_msg_at: new Date().toISOString(),
        market
      });

      const hinglish = isHinglish(market);
      await sendWhatsApp(phone, 'welcome_v1', {
        name: senderName || 'there',
        templateParams: [senderName || 'there']
      });

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeProgram(incomingMsg);
      if (route) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: route.program
          })
          .eq('id', existingLead.id);

        const hinglish = isHinglish(market);
        const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${route.program}`;
        const intakeUrl = `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`;

        await sendWhatsApp(phone, 'program_match', {
          name: senderName || existingLead.name || 'there',
          templateParams: [
            senderName || existingLead.name || 'there',
            route.label,
            checkoutUrl,
            intakeUrl
          ]
        });

        return res.status(200).json({ action: 'qualified', program: route.program });
      }
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
