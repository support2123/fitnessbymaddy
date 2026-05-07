const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplateForced } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6_week_burn': '6wk_gym',
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

function verifyWebhookSignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id
    } = req.body;

    if (!customer_phone) return res.status(400).json({ error: 'No phone number' });

    const db = getSupabase();

    const programKey = PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await db.from('leads').update({
        status: 'converted',
        name: customer_name || undefined
      }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: customer_phone,
      name: customer_name,
      email: customer_email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    const { error: storageErr } = await db.storage
      .from('clients')
      .upload(`${client.id}/.keep`, new Uint8Array(0), { upsert: true });

    if (!storageErr) {
      await db.from('clients').update({
        folder_url: folderPath
      }).eq('id', client.id);
    }

    await sendTemplateForced(customer_phone, `onboard_${programKey}`, [
      customer_name || 'there',
      `${durationDays / 7} weeks`
    ]);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
