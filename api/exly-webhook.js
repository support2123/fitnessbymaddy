const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84, 'pcos': 42,
  '40plus': 42, 'zoom_trial': 7,
  'zoom_pack': 30
};

function verifyWebhook(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhook(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      checkout_id, phone, name, email,
      product_name, amount, currency, status
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      if (status === 'failed') {
        const sb = getSupabase();
        const { data: client } = await sb.from('clients').select('*').eq('phone', phone).eq('status', 'active').single();
        if (client) {
          await notifyMaddy(
            `💳 PAYMENT FAILED\nClient: ${name || phone}\nAmount: ${amount}\nCheckout: ${checkout_id}`
          );
        }
      }
      return res.status(200).json({ action: 'skipped', status });
    }

    const sb = getSupabase();

    let program = 'zoom_trial';
    const pLower = (product_name || '').toLowerCase();
    if (pLower.includes('12') || pLower.includes('custom') || pLower.includes('flagship')) program = '12wk';
    else if (pLower.includes('pcos')) program = 'pcos';
    else if (pLower.includes('40') || pLower.includes('strong')) program = '40plus';
    else if (pLower.includes('shred') || pLower.includes('burn') || pLower.includes('6')) program = '6wk_gym';
    else if (pLower.includes('zoom') && pLower.includes('pack')) program = 'zoom_pack';
    else if (pLower.includes('trial') || pLower.includes('zoom')) program = 'zoom_trial';

    const { data: lead } = await sb
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const duration = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + duration * 24 * 60 * 60 * 1000);

    const { data: client } = await sb.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await sb.storage.from('clients').upload(
      `${folderPath}/.keep`,
      new Uint8Array([0]),
      { contentType: 'application/octet-stream' }
    );
    await sb.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    if (lead?.id) {
      await sb.from('intake_forms').update({ client_id: client.id }).eq('lead_id', lead.id);
    }

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
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

    await notifyMaddy(
      `🎉 NEW CLIENT!\n${name || phone}\nProgram: ${program}\nAmount: $${amount || '?'}`
    );

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
