const { getSupabase } = require('./_lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12_week_custom': '12wk',
  '12wk': '12wk',
  'pcos_warrior': 'pcos',
  'pcos': 'pcos',
  '40_plus': '40plus',
  '40plus': '40plus',
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

function verifyWebhook(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhook(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      product_id,
      amount,
      checkout_id,
      status
    } = req.body;

    if (status && status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const { data: lead } = await db
          .from('leads')
          .select('id')
          .eq('phone', customer_phone)
          .maybeSingle();

        if (lead) {
          await notifyMaddy(
            'Payment failed for lead',
            `Name: ${customer_name}\nPhone: ${maskPhone(customer_phone)}\nProduct: ${product_name}`
          );
        }
      }
      return res.status(200).json({ ok: true, action: 'non_paid_status' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
    const program = PROGRAM_MAP[product_id] || PROGRAM_MAP[product_name?.toLowerCase()?.replace(/\s+/g, '_')] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .maybeSingle();

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : null,
      checkout_id: checkout_id || product_id,
      folder_url: null,
      status: 'active'
    };

    let clientId;
    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db.from('clients').insert(clientData).select('id').single();
      clientId = newClient.id;
    }

    const folderPath = `clients/${clientId}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      upsert: true
    });
    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', clientId);

    const templateName = `onboard_${program}`;
    await sendTemplateForced(phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId, program });

  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
