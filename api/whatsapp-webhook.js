const { getSupabase } = require('../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../lib/whatsapp');
const { detectMarket, getWelcome, getNudge } = require('../lib/market');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { canSendMessage, logMessage } = require('../lib/rate-limit');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim', 'lean'], program: '6wk_gym', name: '6-Week Burn & Build', price: '$97' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior', price: '$45' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior', 'age'], program: '40plus', name: '40+ Strong', price: '$50' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12-Week Flagship', price: '$200' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial', price: '$20' },
  { keywords: ['home', 'no gym', 'bodyweight', 'at home'], program: '6wk_home', name: '6-Week Home Burn', price: '$97' },
];

function routeProgram(text) {
  if (!text) return null;
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
    const payload = req.body;
    const phone = payload.mobile || payload.from || payload.senderMobile;
    const text = payload.message || payload.text || payload.body || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    await logMessage(phone, 'in', text, null);

    if (/^(stop|unsubscribe|optout|opt out)$/i.test(text.trim())) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();

      await createEscalation(
        phone,
        client?.id || null,
        'Keyword trigger in message',
        text
      );
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);

      await db.from('leads').insert({
        phone,
        name: payload.name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
      });

      const welcome = getWelcome(market);
      await sendTemplate(phone, 'welcome_v1', []);
      await logMessage(phone, 'out', welcome, 'welcome_v1');

      return res.status(200).json({ action: 'new_lead', market });
    }

    await db
      .from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('phone', phone);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'dropped_lead_ignored' });
    }

    if (existingLead.status === 'new') {
      const route = routeProgram(text);

      if (route) {
        await db
          .from('leads')
          .update({
            status: 'qualified',
            program_interest: route.program,
          })
          .eq('phone', phone);

        const allowed = await canSendMessage(phone);
        if (allowed) {
          const market = existingLead.market || 'GLOBAL';
          const msg = market === 'IN'
            ? `Great choice! ${route.name} (${route.price}) — Maddy ka sabse effective program. Yahan se checkout karo 👇`
            : `Great choice! ${route.name} (${route.price}) — one of Maddy's most effective programs. Check out here 👇`;

          await sendText(phone, msg);
          await logMessage(phone, 'out', msg, null);

          const intakeMsg = market === 'IN'
            ? 'Aur yeh intake form bhi fill karo taaki Maddy tumhare liye plan customize kar sake:'
            : 'Also fill out this intake form so Maddy can customise your plan:';

          await sendText(phone, `${intakeMsg}\nhttps://fitnessbymaddy.com/intake?lead=${existingLead.id}`);
          await logMessage(phone, 'out', intakeMsg, null);
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
