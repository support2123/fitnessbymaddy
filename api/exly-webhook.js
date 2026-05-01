const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { weeksForProgram, jsonResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, {}, 200);
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const payload = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (sig && sig !== expected) {
      return jsonResponse(res, { error: 'Invalid signature' }, 401);
    }
  }

  const db = getSupabase();
  const {
    phone, name, email, amount, checkout_id,
    product_name, product_id,
  } = req.body || {};

  if (!phone) return jsonResponse(res, { error: 'phone required' }, 400);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = lead?.program_interest || inferProgram(product_name) || '6wk_gym';
  const weeks = weeksForProgram(program);
  const now = new Date();
  const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client, error } = await db.from('clients').upsert({
    lead_id: lead?.id || null,
    phone,
    name: name || lead?.name,
    email,
    program,
    paid_amount: amount ? parseFloat(amount) : null,
    checkout_id: checkout_id || product_id,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    status: 'active',
  }, { onConflict: 'phone' }).select().single();

  if (error) {
    console.error('Client upsert error:', error.message);
    return jsonResponse(res, { error: 'Failed to create client' }, 500);
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendTemplate(phone, `onboard_${program}`, [
    name || 'there',
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week-1 generation trigger failed:', err.message);
    }
  }

  return jsonResponse(res, { ok: true, client_id: client.id });
};

function inferProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (/pcos/.test(lower)) return 'pcos';
  if (/40/.test(lower)) return '40plus';
  if (/12/.test(lower)) return '12wk';
  if (/home/.test(lower)) return '6wk_home';
  if (/trial|zoom/.test(lower)) return 'zoom_trial';
  return '6wk_gym';
}
