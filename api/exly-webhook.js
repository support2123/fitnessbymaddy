const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/masking');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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

    const {
      event, customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, currency,
    } = req.body;

    if (event !== 'payment.success' && event !== 'order.completed') {
      return res.status(200).json({ ok: true, skipped: true });
    }

    const phone = customer_phone?.startsWith('+')
      ? customer_phone
      : '+' + (customer_phone || '');

    if (!phone || phone === '+') {
      return res.status(400).json({ error: 'No phone number' });
    }

    const db = getSupabase();

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('checkout_id', checkout_id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      return res.status(200).json({ ok: true, message: 'Already processed' });
    }

    const { data: leads } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const lead = leads?.[0];
    const program = mapProductToProgram(product_name);
    const programDuration = getProgramDuration(program);

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + programDuration);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount || 0,
      checkout_id,
      status: 'active',
    }).select().single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    const templateName = `onboard_${program}`;
    await sendWhatsApp({
      phone,
      templateName,
      bodyValues: [customer_name || 'there'],
    });

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err);

    if (req.body?.customer_phone) {
      await escalateToMaddy({
        reason: 'Payment webhook processing failed',
        phone: maskPhone(req.body.customer_phone),
        message: err.message,
      }).catch(() => {});
    }

    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getProgramDuration(program) {
  const durations = {
    '6wk_gym': 42,
    '6wk_home': 42,
    '12wk': 84,
    'pcos': 42,
    '40plus': 42,
    'zoom_trial': 7,
    'zoom_pack': 30,
  };
  return durations[program] || 42;
}
