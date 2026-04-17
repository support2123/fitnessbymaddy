const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');
const { parseBody, json, verifyExlySignature } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const body = await parseBody(req);
  const signature = req.headers['x-exly-signature'];

  if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(body, signature)) {
    return json(res, 401, { error: 'Invalid signature' });
  }

  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, status,
  } = body;

  if (status !== 'completed' && status !== 'success') {
    if (status === 'failed') {
      await notifyMaddy('Payment failed', `Phone: ${(customer_phone || '').substring(0, 4)}XXX\nProduct: ${product_name}`);
    }
    return json(res, 200, { action: 'ignored', status });
  }

  const phone = customer_phone;
  if (!phone) return json(res, 400, { error: 'No customer phone' });

  const db = getSupabase();

  const program = mapProductToProgram(product_name);

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programDays = program === '12wk' ? 84 : program === 'zoom_trial' ? 7 : 42;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + programDays * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead ? lead.id : null,
    phone,
    name: customer_name || (lead ? lead.name : null),
    email: customer_email,
    program,
    program_started_at: startDate.toISOString(),
    program_ends_at: endDate.toISOString(),
    paid_amount: amount ? parseFloat(amount) : null,
    checkout_id: checkout_id || null,
    status: 'active',
  }).select().single();

  if (error) {
    console.error('Client insert error:', error.message);
    return json(res, 500, { error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Uint8Array(0), {
    contentType: 'text/plain',
    upsert: true,
  });
  await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

  await sendWhatsApp(phone, `onboard_${program}`, [
    customer_name || 'there',
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (err) {
      console.error('Week 1 program generation failed:', err.message);
    }
  }

  return json(res, 200, { success: true, client_id: client.id, program });
};

function mapProductToProgram(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
