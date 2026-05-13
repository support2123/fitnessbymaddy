const { getSupabase } = require('./lib/supabase');
const { sendTemplateForced, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const webhookSecret = process.env.EXLY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'];
      if (signature) {
        const expected = crypto.createHmac('sha256', webhookSecret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const { customer_phone, customer_email, customer_name, product_id,
            product_name, amount, checkout_id, currency } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const supabase = getSupabase();
    const phone = normalizePhone(customer_phone);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = mapProductToProgram(product_id, product_name, lead?.program_interest);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name || lead?.name || null,
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: parseInt(amount) || 0,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client create error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `${client.id}/`;
    await supabase.storage.from('clients').upload(
      `${folderPath}.keep`, Buffer.from(''), { upsert: true }
    );
    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendTemplateForced(phone, `onboard_${program}`, {
      name: customer_name || lead?.name || 'there',
      templateParams: [
        customer_name || lead?.name || 'there',
        program,
        durationDays.toString()
      ]
    });

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
        console.error('Initial program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy(
      'Payment webhook error',
      `Error: ${err.message}`
    ).catch(() => {});
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}

function mapProductToProgram(productId, productName, leadInterest) {
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('trial') || name.includes('zoom trial')) return 'zoom_trial';
  if (name.includes('zoom pack')) return 'zoom_pack';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('shred') || name.includes('6 week') || name.includes('burn')) return '6wk_gym';
  return leadInterest || '6wk_gym';
}
