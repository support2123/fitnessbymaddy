const { supabase } = require('../lib/supabase');
const {
  sendWhatsApp, maskPhone, detectMarket,
  detectProgram, needsEscalation, isOptOut
} = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalate');

const PROGRAM_NAMES = {
  '6wk_gym': '6-Week Burn & Build (Gym)',
  '6wk_home': '6-Week Burn & Build (Home)',
  '12wk': '12-Week Custom Flagship',
  'pcos': 'PCOS Warrior Program',
  '40plus': '40+ Strong Program',
  'zoom_trial': '$20 Zoom Trial',
  'zoom_pack': 'Zoom Pack'
};

const PROGRAM_PRICES = {
  '6wk_gym': 97, '6wk_home': 97, '12wk': 200,
  'pcos': 45, '40plus': 50, 'zoom_trial': 20, 'zoom_pack': 80
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { phone, message, name } = parseWebhook(req.body);
    if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });

    await supabase.from('messages').insert({
      phone: maskPhone(phone),
      direction: 'in',
      body: message.slice(0, 500)
    });

    if (isOptOut(message)) {
      await supabase.from('leads').update({ status: 'dropped' }).eq('phone', phone);
      return res.json({ action: 'opted_out' });
    }

    if (needsEscalation(message)) {
      await escalateToMaddy('Sensitive keyword detected', `Phone: ${maskPhone(phone)}\nMsg: ${message.slice(0, 200)}`);
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!existingLead) {
      return await handleNewLead(res, phone, message, name);
    }

    if (existingLead.status === 'dropped') {
      return res.json({ action: 'ignored_dropped' });
    }

    if (existingLead.status === 'new') {
      return await handleQualification(res, existingLead, message);
    }

    await supabase.from('leads').update({ last_msg_at: new Date().toISOString() }).eq('id', existingLead.id);
    return res.json({ action: 'updated_existing' });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

async function handleNewLead(res, phone, message, name) {
  const market = detectMarket(phone);
  const { data: lead } = await supabase.from('leads').insert({
    phone,
    name: name || null,
    source: 'whatsapp',
    status: 'new',
    first_msg: message.slice(0, 500),
    market
  }).select().single();

  const isHinglish = market === 'IN';
  const template = isHinglish ? 'welcome_v1_hi' : 'welcome_v1_en';
  await sendWhatsApp(phone, template, [name || 'there']);

  return res.json({ action: 'new_lead', lead_id: lead.id });
}

async function handleQualification(res, lead, message) {
  const program = detectProgram(message);
  if (!program) {
    const isHinglish = lead.market === 'IN';
    await sendWhatsApp(lead.phone, isHinglish ? 'ask_goal_hi' : 'ask_goal_en', []);
    return res.json({ action: 'asked_goal' });
  }

  await supabase.from('leads').update({
    status: 'qualified',
    program_interest: program,
    last_msg_at: new Date().toISOString()
  }).eq('id', lead.id);

  const programName = PROGRAM_NAMES[program];
  const price = PROGRAM_PRICES[program];
  const isHinglish = lead.market === 'IN';

  await sendWhatsApp(lead.phone, isHinglish ? 'program_offer_hi' : 'program_offer_en', [
    lead.name || 'there',
    programName,
    `$${price}`,
    `https://fitnessbymaddyy.exlyapp.com/checkout/${lead.id}`,
    `https://www.fitnessbymaddy.com/intake?lead=${lead.id}`
  ]);

  return res.json({ action: 'qualified', program });
}

function parseWebhook(body) {
  if (!body) return {};
  if (body.phone && body.message) return body;
  if (body.data) {
    return {
      phone: body.data.customer?.phone || body.data.from,
      message: body.data.message?.text || body.data.text || '',
      name: body.data.customer?.name || body.data.pushName || null
    };
  }
  return {
    phone: body.from || body.sender,
    message: body.text || body.body || '',
    name: body.pushName || body.name || null
  };
}
