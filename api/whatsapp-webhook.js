const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, logMessage, maskPhone } = require('./lib/whatsapp');
const { needsEscalation, escalateToMaddy, isOptOut } = require('./lib/escalation');
const { detectMarket, isHinglishMarket } = require('./lib/market');

const PROGRAM_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose weight', 'slim'], program: '6wk_gym', name: '6 Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', name: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint pain', 'senior'], program: '40plus', name: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personalised', 'personalized'], program: '12wk', name: '12 Week Custom Program' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', name: 'Zoom Trial Session' },
  { keywords: ['home', 'no gym', 'bodyweight', 'home workout'], program: '6wk_home', name: '6 Week Home Program' },
];

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'webhook active' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body;
    const phone = payload.senderPhone || payload.from || payload.waId || '';
    const message = payload.text || payload.message || payload.body || '';
    const senderName = payload.senderName || payload.pushName || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    await logMessage(phone, 'in', message, null);

    if (isOptOut(message)) {
      await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      await db.from('clients').update({ status: 'paused' }).eq('phone', phone);
      return res.status(200).json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Keyword trigger in WhatsApp message', { phone: maskPhone(phone), message });
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id, status')
      .eq('phone', phone)
      .eq('status', 'active')
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ action: 'active_client_message', client_id: existingClient[0].id });
    }

    const { data: existingLead } = await db
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .limit(1);

    if (existingLead && existingLead.length > 0) {
      const lead = existingLead[0];

      if (lead.status === 'dropped') {
        return res.status(200).json({ action: 'dropped_lead' });
      }

      const matched = matchProgram(message);
      if (matched) {
        await db.from('leads').update({
          status: 'qualified',
          program_interest: matched.program,
          last_msg_at: new Date().toISOString(),
        }).eq('id', lead.id);

        const hinglish = isHinglishMarket(phone);
        const templateName = hinglish ? 'program_match_hi' : 'program_match_en';
        await sendWhatsApp(phone, templateName, [
          senderName || 'there',
          matched.name,
          `https://fitnessbymaddyy.exlyapp.com/checkout/${matched.program}`,
          `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`,
        ]);

        return res.status(200).json({ action: 'qualified', program: matched.program });
      }

      await db.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', lead.id);
      return res.status(200).json({ action: 'existing_lead_reply' });
    }

    const market = detectMarket(phone);
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name: senderName || null,
      source: 'whatsapp',
      status: 'new',
      first_msg: message,
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString(),
    }).select().single();

    const hinglish = isHinglishMarket(phone);
    const welcomeTemplate = hinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, welcomeTemplate, [senderName || 'there']);

    return res.status(200).json({ action: 'new_lead', lead_id: newLead?.id });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(message) {
  const lower = (message || '').toLowerCase();
  for (const route of PROGRAM_ROUTES) {
    if (route.keywords.some(kw => lower.includes(kw))) {
      return route;
    }
  }
  return null;
}
