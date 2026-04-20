const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, normalizePhone } = require('../lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus': '40plus',
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.customer_phone || '');
    const email = payload.email || payload.customer_email || '';
    const name = payload.name || payload.customer_name || '';
    const checkoutId = payload.checkout_id || payload.order_id || '';
    const paidAmount = payload.amount || payload.paid_amount || 0;
    const productSlug = payload.product_slug || payload.product || '';

    if (!phone) {
      return res.status(400).json({ error: 'No phone number in payload' });
    }

    const db = getSupabase();
    const program = PROGRAM_MAP[productSlug] || '12wk';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `/clients/${phone}/`;

    const clientData = {
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round(paidAmount * 100),
      checkout_id: checkoutId,
      folder_url: folderPath,
      status: 'active'
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
      clientId = newClient.id;
    }

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      params: [name || 'there']
    });

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.CRON_SECRET}`
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
