const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const expected = crypto.createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, program, amount, checkout_id } = extractPurchaseData(req.body);

    if (!phone || !program) {
      return res.status(400).json({ error: 'phone and program required' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      program_started_at: startsAt.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || null,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(
      `${client.id}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      const generateUrl = `${getBaseUrl(req)}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};

function extractPurchaseData(body) {
  return {
    phone: body.phone || body.customer_phone || body.buyer?.phone || '',
    name: body.name || body.customer_name || body.buyer?.name || '',
    email: body.email || body.customer_email || body.buyer?.email || '',
    program: body.program || mapProductToProgram(body.product_name || body.product || ''),
    amount: body.amount || body.total_amount || body.payment?.amount || 0,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || '',
  };
}

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('6 week') || lower.includes('shred') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('12 week') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
