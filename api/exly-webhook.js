const { supabase } = require('./lib/supabase');
const { sendWhatsApp, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-webhook-secret'] || req.headers['x-exly-secret'];
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, name, email, amount, checkout_id, product_name } = req.body;
  if (!phone) return res.status(400).json({ error: 'Missing phone' });

  const program = mapExlyProduct(product_name);

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const startDate = new Date();
  const weeks = program.startsWith('12wk') ? 12 : 6;
  const endDate = new Date(startDate.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client } = await supabase.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name || '',
    email: email || '',
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount || 0,
    checkout_id: checkout_id || '',
    status: 'active'
  }).select().single();

  if (!client) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await sendWhatsApp(phone, `onboard_${program}`, {
    name: name || 'there',
    templateParams: [name || 'there', programLabel(program)]
  });

  await supabase.from('messages').insert({
    phone: maskPhone(phone),
    direction: 'out',
    body: `Onboarded to ${program}`,
    template_name: `onboard_${program}`,
    sent_at: new Date().toISOString(),
    status: 'sent'
  });

  return res.status(200).json({ action: 'converted', client_id: client.id });
};

function mapExlyProduct(name) {
  const lower = (name || '').toLowerCase();
  if (/12.?week|flagship|custom/.test(lower)) return '12wk';
  if (/pcos/.test(lower)) return 'pcos';
  if (/40\+|forty|senior/.test(lower)) return '40plus';
  if (/home/.test(lower)) return '6wk_home';
  if (/trial|zoom/.test(lower)) return 'zoom_trial';
  if (/pack/.test(lower)) return 'zoom_pack';
  return '6wk_gym';
}

function programLabel(key) {
  const labels = {
    '6wk_gym': '6-Week Burn & Build (Gym)',
    '6wk_home': '6-Week Burn & Build (Home)',
    '12wk': '12-Week Custom Flagship',
    'pcos': 'PCOS Warrior Program',
    '40plus': '40+ Strong Program',
    'zoom_trial': 'Zoom Trial Session',
    'zoom_pack': 'Zoom Session Pack'
  };
  return labels[key] || key;
}
