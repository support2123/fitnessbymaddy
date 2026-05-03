const { supabase } = require('./lib/supabase');
const {
  sendWhatsApp, maskPhone, detectMarket,
  detectProgram, needsEscalation, isOptOut
} = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const payload = req.body;
  const phone = payload.mobile || payload.from || payload.senderMobile;
  const text = payload.text || payload.message || payload.body || '';
  const name = payload.name || payload.senderName || '';

  if (!phone) return res.status(400).json({ error: 'No phone number' });

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'in',
    body: text.slice(0, 500),
    sent_at: new Date().toISOString(),
    status: 'received'
  });

  if (isOptOut(text)) {
    await supabase
      .from('leads')
      .update({ status: 'dropped' })
      .eq('phone', phone);
    return res.status(200).json({ action: 'opted_out' });
  }

  if (needsEscalation(text)) {
    await escalateToMaddy(
      'Keyword trigger in message',
      `Phone: ${maskPhone(phone)} | Msg: ${text.slice(0, 200)}`
    );
  }

  const { data: existingLead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!existingLead) {
    const market = detectMarket(phone);
    const { data: newLead } = await supabase.from('leads').insert({
      phone,
      name,
      source: 'whatsapp',
      status: 'new',
      first_msg: text.slice(0, 500),
      last_msg_at: new Date().toISOString(),
      market,
      created_at: new Date().toISOString()
    }).select().single();

    const lang = market === 'IN' ? 'hinglish' : 'english';
    const template = lang === 'hinglish' ? 'welcome_v1_hi' : 'welcome_v1_en';
    await sendWhatsApp(phone, template, { name: name || 'there' });

    return res.status(200).json({ action: 'new_lead', id: newLead?.id });
  }

  if (existingLead.status === 'dropped') {
    return res.status(200).json({ action: 'ignored_dropped' });
  }

  await supabase
    .from('leads')
    .update({ last_msg_at: new Date().toISOString() })
    .eq('id', existingLead.id);

  if (existingLead.status === 'new') {
    const program = detectProgram(text);
    if (program) {
      await supabase
        .from('leads')
        .update({ status: 'qualified', program_interest: program })
        .eq('id', existingLead.id);

      const checkoutUrl = `https://fitnessbymaddyy.exlyapp.com/checkout/${existingLead.id}`;
      const intakeUrl = `https://fitnessbymaddy.com/intake?lead=${existingLead.id}`;

      await sendWhatsApp(phone, 'program_offer', {
        name: name || existingLead.name || 'there',
        templateParams: [programLabel(program), checkoutUrl, intakeUrl]
      });

      return res.status(200).json({ action: 'qualified', program });
    }
  }

  return res.status(200).json({ action: 'noted' });
};

function programLabel(key) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': '$20 Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[key] || key;
}
