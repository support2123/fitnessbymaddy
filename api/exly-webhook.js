const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { event, data } = req.body;
    if (event !== 'purchase.completed' && event !== 'payment.success') {
      return res.status(200).json({ action: 'ignored', event });
    }

    const phone = data.phone || data.customer_phone || '';
    const email = data.email || data.customer_email || '';
    const name = data.name || data.customer_name || '';
    const amount = data.amount || data.paid_amount || 0;
    const checkoutId = data.checkout_id || data.order_id || '';
    const productKey = data.product_key || data.product || '';

    const program = PROGRAM_MAP[productKey] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;

    const db = getSupabase();

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lead = leads?.[0];
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round(amount * 100),
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: `Welcome to FitnessByMaddy! Your ${program.replace(/_/g, ' ')} program starts now. We'll send your first check-in form in 7 days. Let's crush this!`,
      isClient: true
    });

    if (program === '12wk') {
      const origin = req.headers['x-forwarded-host'] || req.headers.host || 'www.fitnessbymaddy.com';
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      fetch(`${protocol}://${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
