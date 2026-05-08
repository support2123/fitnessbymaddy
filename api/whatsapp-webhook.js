const { supabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglishMarket } = require('./_lib/market');
const { checkEscalation } = require('./_lib/escalation');

const KEYWORD_ROUTES = [
  { keywords: ['fat loss', 'weight', 'shred', 'lose', 'slim'], program: '6wk_gym', label: '6-Week Burn & Build' },
  { keywords: ['pcos', 'hormonal', 'hormone', 'pcod'], program: 'pcos', label: 'PCOS Warrior' },
  { keywords: ['40', 'menopause', 'joints', 'joint', 'senior'], program: '40plus', label: '40+ Strong' },
  { keywords: ['custom', '12 week', 'serious', 'flagship', 'personal'], program: '12wk', label: '12-Week Custom' },
  { keywords: ['trial', 'zoom', 'not sure', 'try', 'test'], program: 'zoom_trial', label: 'Zoom Trial' }
];

const STOP_WORDS = ['stop', 'unsubscribe', 'cancel', 'opt out', 'optout'];

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { phone, message, name } = parseWebhookBody(req.body);
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const lower = (message || '').toLowerCase().trim();

    await supabase.from('messages').insert({
      phone, direction: 'in', body: message
    });

    if (STOP_WORDS.some(w => lower.includes(w))) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    const escalated = await checkEscalation(phone, message);
    if (escalated) {
      await sendWhatsApp({
        phone,
        templateName: 'escalation_ack',
        params: [name || 'there']
      });
      return res.json({ action: 'escalated' });
    }

    const { data: existing } = await supabase
      .from('leads')
      .select('id, status')
      .eq('phone', phone)
      .single();

    if (!existing) {
      return await handleNewLead(phone, name, message, res);
    }

    if (existing.status === 'new') {
      return await handleQualification(phone, existing.id, message, res);
    }

    if (existing.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    return res.json({ action: 'existing_lead', status: existing.status });
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function parseWebhookBody(body) {
  if (body.entry) {
    const change = body.entry?.[0]?.changes?.[0]?.value;
    const msg = change?.messages?.[0];
    return {
      phone: msg?.from ? `+${msg.from}` : null,
      message: msg?.text?.body || '',
      name: change?.contacts?.[0]?.profile?.name || ''
    };
  }
  return {
    phone: body.phone || body.destination || body.from,
    message: body.message || body.text || body.body || '',
    name: body.name || body.userName || ''
  };
}

async function handleNewLead(phone, name, message, res) {
  const market = detectMarket(phone);
  const hinglish = isHinglishMarket(market);

  await supabase.from('leads').insert({
    phone, name, source: 'whatsapp', status: 'new',
    first_msg: message, last_msg_at: new Date().toISOString(), market
  });

  const templateName = hinglish ? 'welcome_v1_hi' : 'welcome_v1';
  await sendWhatsApp({
    phone,
    templateName,
    params: [name || 'there']
  });

  return res.json({ action: 'new_lead', market });
}

async function handleQualification(phone, leadId, message, res) {
  const lower = (message || '').toLowerCase();

  await supabase.from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', leadId);

  const match = KEYWORD_ROUTES.find(r => r.keywords.some(kw => lower.includes(kw)));

  if (!match) {
    return res.json({ action: 'no_keyword_match' });
  }

  await supabase.from('leads').update({
    status: 'qualified', program_interest: match.program
  }).eq('id', leadId);

  const { data: lead } = await supabase
    .from('leads')
    .select('market')
    .eq('id', leadId)
    .single();

  const hinglish = isHinglishMarket(lead?.market);

  await sendWhatsApp({
    phone,
    templateName: 'program_match',
    params: [
      match.label,
      `https://fitnessbymaddyy.exlyapp.com/checkout/${match.program}`,
      `https://www.fitnessbymaddy.com/intake?lead=${leadId}`
    ]
  });

  return res.json({ action: 'qualified', program: match.program });
}
