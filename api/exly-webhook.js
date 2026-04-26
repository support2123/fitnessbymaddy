const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy, maskPhone } = require('../lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });
    if (paymentStatus && paymentStatus !== 'success' && paymentStatus !== 'completed') {
      if (paymentStatus === 'failed') {
        await notifyMaddy('Payment failed', `Phone: ${maskPhone(phone)}\nProduct: ${product_name}`);
      }
      return res.json({ action: 'payment_not_successful', status: paymentStatus });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ action: 'client_created', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
