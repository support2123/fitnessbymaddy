const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../lib/market');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

const PROGRAM_ROUTES = {
  fat_loss: { keywords: ['fat loss', 'weight loss', 'weight', 'shred', 'lean', 'cut', 'slim'], program: '6wk_gym', name: '6-Week Burn & Build' },
  pcos: { keywords: ['pcos', 'hormonal', 'hormone', 'period', 'irregular'], program: 'pcos', name: 'PCOS Warrior' },
  fortyplus: { keywords: ['40', 'forty', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong' },
  flagship: { keywords: ['custom', '12 week', '12-week', 'serious', 'transform', 'full'], program: '12wk', name: '12-Week Flagship' },
  trial: { keywords: ['trial', 'zoom', 'not sure', 'try', 'test', 'unsure'], program: 'zoom_trial', name: 'Zoom Trial' }
};

function detectProgram(text) {
  const lower = (text || '').toLowerCase();
  for (const [key, route] of Object.entries(PROGRAM_ROUTES)) {
    if (route.keywords.some(kw => lower.includes(kw))) return route;
  }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const payload = req.body;
    const phone = payload.phone || payload.from || payload.senderPhone || '';
    const text = payload.text || payload.message || payload.body || '';
    const name = payload.name || payload.senderName || '';

    if (!phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();
    const market = detectMarket(phone);

    await db.from('messages').insert({
      phone,
      direction: 'in',
      body: text,
      template_name: null,
      sent_at: new Date().toISOString(),
      status: 'received'
    });

    const stopWords = ['stop', 'unsubscribe', 'opt out', 'cancel'];
    if (stopWords.some(w => (text || '').toLowerCase().includes(w))) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      console.log(`Opt-out: ${maskPhone(phone)}`);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(text)) {
      await escalateToMaddy('Incoming message flagged', {
        phone: maskPhone(phone),
        detail: text.slice(0, 200)
      });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (!existingLead) {
      await db.from('leads').insert({
        phone,
        name: name || null,
        source: 'whatsapp',
        status: 'new',
        first_msg: text,
        last_msg_at: new Date().toISOString(),
        market,
        created_at: new Date().toISOString()
      });

      const templateName = isHinglish(market) ? 'welcome_v1_hi' : 'welcome_v1';
      await sendTemplate(phone, templateName, {
        name: name || 'there',
        templateParams: [name || 'there']
      });

      return res.status(200).json({ action: 'new_lead_welcomed' });
    }

    await db.from('leads')
      .update({ last_msg_at: new Date().toISOString() })
      .eq('id', existingLead.id);

    if (existingLead.status === 'dropped') {
      return res.status(200).json({ action: 'lead_dropped_ignored' });
    }

    const program = detectProgram(text);
    if (program && existingLead.status === 'new') {
      await db.from('leads')
        .update({
          status: 'qualified',
          program_interest: program.program
        })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${program.program}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      const msg = isHinglish(market)
        ? `${program.name} — perfect choice! Yeh raha checkout link: ${checkoutUrl}\n\nSaath mein yeh form bhi fill karo: ${intakeUrl}`
        : `${program.name} — great choice! Here's your checkout link: ${checkoutUrl}\n\nAlso fill out this quick form: ${intakeUrl}`;

      await sendTemplate(phone, 'program_checkout', {
        name: name || existingLead.name || 'there',
        templateParams: [
          name || existingLead.name || 'there',
          program.name,
          checkoutUrl,
          intakeUrl
        ]
      });

      return res.status(200).json({ action: 'qualified', program: program.program });
    }

    return res.status(200).json({ action: 'message_logged' });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
