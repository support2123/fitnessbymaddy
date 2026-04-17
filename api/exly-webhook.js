const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { PROGRAM_DETAILS } = require('./lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  try {
    const {
      customer_name,
      customer_email,
      customer_phone,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ ok: true, skipped: 'not a completed payment' });
    }

    const db = getSupabase();

    const program = matchProgram(product_name, amount);
    const details = PROGRAM_DETAILS[program] || {};

    const phone = normalizePhone(customer_phone);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + (details.duration_weeks || 6) * 7);

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active',
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;
    if (existingClient) {
      await db.from('clients').update(clientData).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await db
        .from('clients')
        .insert(clientData)
        .select('id')
        .single();
      clientId = newClient?.id;
    }

    if (clientId) {
      await db.storage
        .from('client-files')
        .upload(`clients/${clientId}/.keep`, new Uint8Array(0), { upsert: true });
    }

    const templateName = `onboard_${program}`;
    await sendWhatsApp(phone, templateName, [
      customer_name || 'there',
      details.name || program,
    ]);

    if (program === '12wk' && clientId) {
      try {
        const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (e) {
        console.error('[exly-webhook] Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: clientId });
  } catch (err) {
    console.error('[exly-webhook] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

function matchProgram(productName, amount) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  if (amount <= 25) return 'zoom_trial';
  if (amount <= 50) return 'pcos';
  if (amount <= 100) return '6wk_gym';
  return '12wk';
}

function normalizePhone(phone) {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.length === 10) cleaned = '+91' + cleaned;
    else cleaned = '+' + cleaned;
  }
  return cleaned;
}
