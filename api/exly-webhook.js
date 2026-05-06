const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { PROGRAM_MAP } = require('../lib/programs');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, email, name, amount, checkout_id, product_name } = req.body;

    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const programKey = lead?.program_interest || inferProgram(product_name, amount);
    const program = PROGRAM_MAP[programKey] || PROGRAM_MAP['6wk_gym'];

    const now = new Date();
    const programEnds = new Date(now.getTime() + program.duration * 24 * 60 * 60 * 1000);

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || '',
        email: email || '',
        program: programKey,
        program_started_at: now.toISOString(),
        program_ends_at: programEnds.toISOString(),
        paid_amount: amount || program.price,
        checkout_id: checkout_id || null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    await supabase.storage
      .from('client-files')
      .upload(`clients/${client.id}/.keep`, Buffer.from(''), { contentType: 'text/plain' });

    await sendWhatsApp(phone, `onboard_${programKey}`, {
      name: client.name || 'there',
      templateParams: [client.name || 'there', program.name]
    });

    if (programKey === '12wk') {
      await fetch(`${process.env.VERCEL_URL || 'https://fitnessbymaddy.com'}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
