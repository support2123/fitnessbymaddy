const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, canSendToLead, maskPhone } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

const PROGRAM_ROUTES = {
  'fat loss': '6wk_gym', weight: '6wk_gym', shred: '6wk_gym', burn: '6wk_gym',
  pcos: 'pcos', hormonal: 'pcos',
  '40': '40plus', menopause: '40plus', joints: '40plus',
  custom: '12wk', '12 week': '12wk', serious: '12wk', flagship: '12wk',
  trial: 'zoom_trial', zoom: 'zoom_trial', 'not sure': 'zoom_trial',
  home: '6wk_home',
};

const PROGRAM_LABELS = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  pcos: 'PCOS Warrior',
  '40plus': '40+ Strong',
  zoom_trial: '$20 Zoom Trial',
  zoom_pack: 'Zoom Pack',
};

const STOP_WORDS = ['stop', 'unsubscribe', 'opt out', 'cancel messages'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.from || payload.sender;
  const messageBody = (payload.message || payload.text || payload.body || '').trim();
  const senderName = payload.name || payload.senderName || null;

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: messageBody,
  });

  const lower = messageBody.toLowerCase();

  if (STOP_WORDS.some((w) => lower.includes(w))) {
    await db.from('leads').update({ status: 'dropped' }).eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  const escalationKeyword = needsEscalation(messageBody);
  if (escalationKeyword) {
    const { data: client } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle();
    await createEscalation(phone, escalationKeyword, messageBody, client?.id);
  }

  const { data: existingLead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!existingLead) {
    const market = detectMarket(phone);
    await db.from('leads').insert({
      phone,
      name: senderName,
      source: 'whatsapp',
      status: 'new',
      first_msg: messageBody,
      market,
    });

    const welcomeTemplate = market === 'IN' ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendTemplate(phone, welcomeTemplate);

    return res.status(200).json({ action: 'new_lead', market });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await db
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'new') {
    let matchedProgram = null;
    for (const [keyword, program] of Object.entries(PROGRAM_ROUTES)) {
      if (lower.includes(keyword)) {
        matchedProgram = program;
        break;
      }
    }

    if (matchedProgram) {
      await db
        .from('leads')
        .update({ status: 'qualified', program_interest: matchedProgram })
        .eq('id', existingLead.id);

      const label = PROGRAM_LABELS[matchedProgram] || matchedProgram;
      const market = existingLead.market || 'IN';
      const template = market === 'IN' ? 'program_link_hi' : 'program_link_en';

      await sendTemplate(phone, template, [
        label,
        `https://fitnessbymaddyy.exlyapp.com/checkout/${matchedProgram}`,
        `https://www.fitnessbymaddy.com/intake.html?lead=${existingLead.id}`,
      ]);

      return res.status(200).json({ action: 'qualified', program: matchedProgram });
    }
  }

  return res.status(200).json({ action: 'message_logged' });
};
