const { getSupabase } = require('../lib/supabase');
const { detectMarket, sendTemplate, canSendMessage, maskPhone } = require('../lib/whatsapp');
const { needsEscalation, isOptOut, escalate } = require('../lib/escalation');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'burn'], program: '6wk_gym', name: '6 Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'age', 'senior'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', '12week', 'serious', 'transform', 'complete'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6 Week Home Program', price: '$97' },
];

function routeToProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId;
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.senderName || payload.pushName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    if (isOptOut(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalate(phone, 'Keyword trigger in message', text.slice(0, 200));
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      }).select().single();

      const greeting = market === 'IN'
        ? 'welcome_v1_hindi'
        : 'welcome_v1';

      await sendTemplate(phone, greeting, [name || 'there']);

      console.log(`New lead from ${maskPhone(phone)}, market: ${market}`);
      return res.status(200).json({ action: 'new_lead', id: newLead?.id });
    }

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'new') {
      const route = routeToProgram(text);

      if (route) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: route.program
        }).eq('id', existingLead.id);

        const rateOk = await canSendMessage(phone);
        if (rateOk) {
          const market = existingLead.market || detectMarket(phone);
          const templateName = market === 'IN' ? 'program_offer_hindi' : 'program_offer';
          await sendTemplate(phone, templateName, [
            name || existingLead.name || 'there',
            route.name,
            route.price,
            `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`,
            `https://fitnessbymaddy.com/intake.html?lead=${existingLead.id}`
          ]);
        }

        return res.status(200).json({ action: 'qualified', program: route.program });
      }

      return res.status(200).json({ action: 'awaiting_qualification' });
    }

    return res.status(200).json({ action: 'existing_lead', status: existingLead.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
