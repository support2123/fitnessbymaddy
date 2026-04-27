const crypto = require('crypto');
const { getClient } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

function verifySignature(payload, signature, secret) {
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_MAP = {
  '6_week_shred': '6wk_gym',
  '6_week_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12wk': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];

    if (secret && signature) {
      if (!verifySignature(req.body, signature, secret)) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const data = req.body?.data || req.body;
    const customer = data.customer || data;
    const phone = (customer.phone || customer.mobile || '').replace(/[^0-9]/g, '');
    const name = customer.name || customer.full_name || null;
    const email = customer.email || null;
    const amount = parseFloat(data.amount || data.paid_amount || 0);
    const checkoutId = data.checkout_id || data.order_id || data.id || null;
    const productName = (data.product?.name || data.product_name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const program = PROGRAM_MAP[productName] || PROGRAM_MAP[data.product?.id] || '6wk_gym';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const db = getClient();

    let lead;
    const { data: existingLead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (existingLead) {
      lead = existingLead;
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    } else {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name,
        source: 'exly',
        status: 'converted',
        program_interest: program,
      }).select().single();
      lead = newLead;
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: name || lead.name,
      email,
      program,
      program_ends_at: programEnds,
      paid_amount: amount,
      checkout_id: checkoutId,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, [name || 'there'], true);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
