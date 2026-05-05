const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret
  const secret = req.headers['x-webhook-secret'] || req.body.webhook_secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const { phone, email, name, amount, checkout_id, product_name } = req.body;

  if (!phone || !checkout_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Map product to program
  const programMap = {
    '6wk-burn': '6wk_gym',
    '6wk-home': '6wk_home',
    'pcos-warrior': 'pcos',
    '40plus-strong': '40plus',
    '12wk-flagship': '12wk',
    'zoom-trial': 'zoom_trial',
    'zoom-pack': 'zoom_pack',
  };

  const program = programMap[checkout_id] || '6wk_gym';

  // Find or match lead
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  // Calculate program end date
  const programDurations = {
    '6wk_gym': 42, '6wk_home': 42, 'pcos': 42,
    '40plus': 42, '12wk': 84, 'zoom_trial': 7, 'zoom_pack': 30,
  };
  const durationDays = programDurations[program] || 42;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Create client record
  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id,
      status: 'active',
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  // Update lead status
  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  // Create storage folder
  await supabase.storage
    .from('clients')
    .upload(`${client.id}/.keep`, new Blob(['']));

  // Send onboarding WhatsApp
  await sendWhatsApp({
    phone,
    templateName: `onboard_${program}`,
    params: [name || 'there'],
  });

  return res.status(200).json({ success: true, client_id: client.id });
};
