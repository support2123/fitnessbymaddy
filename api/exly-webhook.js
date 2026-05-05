const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { escalateToMaddy } = require('./lib/escalate');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const db = getSupabase();
  const { event, data } = req.body;

  if (event === 'payment.failed') {
    const phone = data.phone || data.customer_phone;
    if (phone) {
      const { data: client } = await db.from('clients').select('*').eq('phone', phone).single();
      if (client && client.status === 'active') {
        await escalateToMaddy('Payment failed for active client', { phone });
      }
    }
    return res.status(200).json({ action: 'payment_failure_noted' });
  }

  if (event !== 'payment.success' && event !== 'order.completed') {
    return res.status(200).json({ action: 'ignored' });
  }

  const phone = data.phone || data.customer_phone;
  const email = data.email || data.customer_email;
  const name = data.name || data.customer_name;
  const amount = data.amount || data.total;
  const checkoutId = data.checkout_id || data.order_id;
  const productName = (data.product_name || data.item_name || '').toLowerCase();

  let program = '6wk_gym';
  if (/12.?week|flagship/i.test(productName)) program = '12wk';
  else if (/pcos/i.test(productName)) program = 'pcos';
  else if (/40\+|40plus/i.test(productName)) program = '40plus';
  else if (/home/i.test(productName)) program = '6wk_home';
  else if (/trial|zoom/i.test(productName)) program = 'zoom_trial';

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const leadId = lead?.id || null;

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const programStart = new Date();
  const weekCount = program === '12wk' ? 12 : 6;
  const programEnd = new Date(programStart.getTime() + weekCount * 7 * 24 * 60 * 60 * 1000);

  const { data: newClient, error } = await db.from('clients').insert({
    lead_id: leadId,
    phone,
    name,
    email,
    program,
    program_started_at: programStart.toISOString(),
    program_ends_at: programEnd.toISOString(),
    paid_amount: parseFloat(amount) || 0,
    checkout_id: checkoutId,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('[EXLY] Client insert error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${newClient.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));
  await db.from('clients').update({ folder_url: folderPath }).eq('id', newClient.id);

  const templateName = `onboard_${program}`;
  await sendWhatsApp(phone, templateName, [name || 'there']);

  if (program === '12wk') {
    await fetch(
      `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/generate-program`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
      }
    );
  }

  return res.status(200).json({ action: 'converted', client_id: newClient.id });
};
