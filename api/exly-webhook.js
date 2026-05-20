const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy, maskPhone } = require('./lib/whatsapp');
const { parseBody, json, PROGRAM_NAMES } = require('./lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (sig !== expected) {
      return json(res, 401, { error: 'invalid signature' });
    }
  }

  const {
    checkout_id, phone, email, name, amount,
    product_name, status: paymentStatus,
  } = body;

  if (paymentStatus !== 'success' && paymentStatus !== 'completed') {
    if (paymentStatus === 'failed') {
      await notifyMaddy('Payment failed', `${maskPhone(phone)}, amount: $${amount}`);
    }
    return json(res, 200, { action: 'payment-not-successful' });
  }

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = lead?.program_interest || inferProgram(product_name, amount);
  const programWeeks = program === '12wk' ? 12 : 6;
  const now = new Date();
  const endsAt = new Date(now.getTime() + programWeeks * 7 * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db
    .from('clients')
    .insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || null,
      status: 'active',
    })
    .select()
    .single();

  if (error) return json(res, 500, { error: error.message });

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

  const programLabel = PROGRAM_NAMES[program] || program;
  await sendWhatsApp(phone, `onboard_${program}`, [
    name || 'there',
    programLabel,
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch {}
  }

  return json(res, 200, { success: true, client_id: client.id });
};

function inferProgram(productName, amount) {
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('custom')) return '12wk';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('home')) return '6wk_home';
  if (amount && parseFloat(amount) >= 150) return '12wk';
  return '6wk_gym';
}
