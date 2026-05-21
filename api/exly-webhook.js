const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

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
  'zoom_pack': 28
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return hash === signature;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const db = getSupabase();
    const {
      checkout_id, customer_phone, customer_name, customer_email,
      product_name, amount, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const { data: client } = await db
          .from('clients')
          .select('phone')
          .eq('checkout_id', checkout_id)
          .single();
        if (client) {
          const { escalate } = require('../lib/escalation');
          await escalate(client.phone, 'Payment failure', `Checkout ${checkout_id} failed for active client`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = customer_phone;
    const programKey = PROGRAM_MAP[product_name] || '12wk';
    const durationDays = PROGRAM_DURATIONS[programKey] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 86400000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program: programKey,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: folderPath
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${programKey}`, [
      customer_name || 'there',
      durationDays.toString()
    ]);

    if (programKey === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week 1 gen trigger failed:', err.message));
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${programKey}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
