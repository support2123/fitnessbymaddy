const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-webhook-signature'] || '';
    const expected = crypto
      .createHmac('sha256', secret)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const supabase = getSupabase();
  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, order_id
  } = req.body;

  if (!customer_phone) {
    return res.status(400).json({ error: 'Missing customer_phone' });
  }

  const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;

  const programMap = {
    '6 week': '6wk_gym',
    'shred': '6wk_gym',
    'burn': '6wk_gym',
    'pcos': 'pcos',
    '40+': '40plus',
    '40 plus': '40plus',
    '12 week': '12wk',
    'custom': '12wk',
    'flagship': '12wk',
    'zoom': 'zoom_trial',
    'trial': 'zoom_trial'
  };

  let program = 'zoom_trial';
  const prodLower = (product_name || '').toLowerCase();
  for (const [key, val] of Object.entries(programMap)) {
    if (prodLower.includes(key)) {
      program = val;
      break;
    }
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const leadId = lead ? lead.id : null;

  if (lead) {
    await supabase
      .from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  const programDurations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    'pcos': 42,
    '40plus': 42,
    '12wk': 84,
    'zoom_trial': 7,
    'zoom_pack': 30
  };

  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (programDurations[program] || 42));

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      lead_id: leadId,
      phone,
      name: customer_name || (lead && lead.name) || '',
      email: customer_email || '',
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || order_id || '',
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await supabase.storage
    .from('client-files')
    .upload(`clients/${client.id}/.keep`, Buffer.from(''), {
      contentType: 'text/plain',
      upsert: true
    });

  await sendWhatsApp(phone, `onboard_${program}`, [
    customer_name || 'there',
    program
  ]);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (e) {
      // Async generation
    }
  }

  return res.status(200).json({ success: true, client_id: client.id });
};
