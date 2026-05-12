const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendDirect } = require('../lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 28
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, product_name, amount,
      checkout_id, status: paymentStatus
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not_paid' });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = lead?.program_interest || inferProgram(product_name);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      program_ends_at: endsAt,
      folder_url: `clients/${phone}/`
    }).select().single();

    if (error) throw error;

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    await supabase.storage.from('clients').upload(
      `${client.id}/.folder_created`,
      'initialized',
      { contentType: 'text/plain', upsert: true }
    );

    await sendDirect(phone, `onboard_${program}`, {
      name: name || 'there',
      templateParams: [name || 'there', program]
    });

    if (program === '12wk') {
      fetch(`https://fitnessbymaddy.com/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('6') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return 'zoom_trial';
}
