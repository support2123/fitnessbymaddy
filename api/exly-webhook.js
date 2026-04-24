const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { corsHeaders, programDisplayName } = require('../lib/utils');
const crypto = require('crypto');

function verifyExlySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return signature === expected;
}

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status: paymentStatus
    } = req.body;

    if (paymentStatus !== 'completed' && paymentStatus !== 'success') {
      if (paymentStatus === 'failed') {
        const { data: activeClient } = await db
          .from('clients')
          .select('id')
          .eq('phone', customer_phone)
          .eq('status', 'active')
          .single();

        if (activeClient) {
          await notifyMaddy(
            'Payment failure for active client',
            `Client: ${customer_name}\nPhone last 4: ...${(customer_phone || '').slice(-4)}`
          );
        }
      }
      return res.status(200).json({ action: 'non_purchase_event' });
    }

    const phone = customer_phone;

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const program = mapExlyProduct(product_name);
    const programDays = program === '12wk' ? 84 : program === '6wk_gym' || program === '6wk_home' ? 42 : 30;
    const endsAt = new Date(Date.now() + programDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('client-files').upload(`${folderPath}/.keep`, new Blob(['']));
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        await fetch(`https://www.fitnessbymaddy.com/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch {
        // Program generation is async — failure here is non-fatal
      }
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return '6wk_gym';
}
