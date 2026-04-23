const { getSupabase } = require('./lib/supabase');
const { sendTemplate, sendText } = require('./lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', 'weight': '6wk_gym', 'shred': '6wk_gym',
  'weight loss': '6wk_gym', 'slim': '6wk_gym', 'lean': '6wk_gym',
  'pcos': 'pcos', 'hormonal': 'pcos', 'hormone': 'pcos',
  '40': '40plus', 'menopause': '40plus', 'joints': '40plus', 'joint': '40plus',
  'custom': '12wk', '12 week': '12wk', 'serious': '12wk', 'flagship': '12wk',
  'trial': 'zoom_trial', 'zoom': 'zoom_trial', 'not sure': 'zoom_trial', 'try': 'zoom_trial'
};

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  '12wk': '12-Week Custom Training',
  'zoom_trial': '$20 Zoom Trial Session'
};

const CHECKOUT_LINKS = {
  '6wk_gym': 'https://fitnessbymaddyy.exlyapp.com/checkout/6wk-shred',
  'pcos': 'https://fitnessbymaddyy.exlyapp.com/checkout/pcos-warrior',
  '40plus': 'https://fitnessbymaddyy.exlyapp.com/checkout/40plus-strong',
  '12wk': 'https://fitnessbymaddyy.exlyapp.com/checkout/12wk-custom',
  'zoom_trial': 'https://fitnessbymaddyy.exlyapp.com/checkout/zoom-trial'
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = req.body;
    const phone = normalizePhone(body.phone || body.from || body.senderPhone || '');
    const text = (body.text || body.message || body.body || '').trim();

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const db = getSupabase();

    await db.from('messages').insert({
      phone, direction: 'in', body: text
    });

    if (/\b(stop|unsubscribe)\b/i.test(text)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Keyword trigger in message', phone, text);
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      const market = detectMarket(phone);
      const { data: lead } = await db.from('leads').insert({
        phone,
        name: body.name || null,
        source: body.source || 'whatsapp',
        status: 'new',
        first_msg: text,
        market
      }).select().single();

      const hinglish = isHinglish(market);
      if (hinglish) {
        await sendTemplate(phone, 'welcome_v1', []);
      } else {
        await sendTemplate(phone, 'welcome_v1_en', []);
      }

      scheduleNudge(phone, lead.id);
      return res.json({ action: 'new_lead', lead_id: lead.id });
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    const matchedProgram = matchProgram(text);
    if (matchedProgram && existingLead.status === 'new') {
      await db.from('leads').update({
        status: 'qualified',
        program_interest: matchedProgram,
        last_msg_at: new Date().toISOString()
      }).eq('id', existingLead.id);

      const market = existingLead.market || 'GLOBAL';
      const hinglish = isHinglish(market);
      const programName = PROGRAM_NAMES[matchedProgram];
      const checkoutUrl = CHECKOUT_LINKS[matchedProgram];
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      let msg;
      if (hinglish) {
        msg = `Perfect! 🎯 ${programName} aapke liye best rahega.\n\n` +
              `Checkout: ${checkoutUrl}\n\n` +
              `Aur yeh intake form bhi fill karo:\n${intakeUrl}`;
      } else {
        msg = `Perfect! 🎯 ${programName} sounds right for you.\n\n` +
              `Checkout here: ${checkoutUrl}\n\n` +
              `Also please fill the intake form:\n${intakeUrl}`;
      }

      await sendText(phone, msg);
      return res.json({ action: 'qualified', program: matchedProgram });
    }

    await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'message_logged' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = phone.replace(/\s+/g, '').replace(/[^+\d]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p;
}

function matchProgram(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
    if (lower.includes(keyword)) return program;
  }
  return null;
}

function scheduleNudge(phone, leadId) {
  const twoHours = 2 * 60 * 60 * 1000;
  const twentyFourHours = 24 * 60 * 60 * 1000;

  setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db.from('leads').select('status, last_msg_at').eq('id', leadId).single();
      if (data && data.status === 'new') {
        const lastMsg = new Date(data.last_msg_at).getTime();
        if (Date.now() - lastMsg >= twoHours - 60000) {
          await sendTemplate(phone, 'nudge_trial', []);
        }
      }
    } catch (e) { console.error('Nudge 2h error:', e.message); }
  }, twoHours);

  setTimeout(async () => {
    try {
      const db = getSupabase();
      const { data } = await db.from('leads').select('status').eq('id', leadId).single();
      if (data && data.status === 'new') {
        await db.from('leads').update({ status: 'dropped' }).eq('id', leadId);
      }
    } catch (e) { console.error('Nudge 24h error:', e.message); }
  }, twentyFourHours);
}
