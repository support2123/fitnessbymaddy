const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const supabase = getSupabase();
  const { phone, email, name, amount, checkout_id, product_name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'No phone in payload' });
  }

  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found' });
  }

  const program = lead.program_interest || inferProgram(product_name);
  const now = new Date();
  const weeks = program === '12wk' ? 12 : 6;
  const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email: email || null,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active'
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }

  await supabase
    .from('leads')
    .update({ status: 'converted' })
    .eq('id', lead.id);

  const folderPath = `clients/${client.id}`;
  await supabase.storage
    .from('programs')
    .upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

  await supabase
    .from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const templateName = `onboard_${program}`;
  await sendTemplate(phone, templateName, {
    name: client.name || 'there',
    templateParams: [client.name || 'there', `${weeks} weeks`]
  });

  if (program === '12wk') {
    await fetch(`https://fitnessbymaddy.com/api/generate-program`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: client.id, week_no: 1 })
    });
  }

  return res.status(200).json({ action: 'converted', client_id: client.id });
};

function inferProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
