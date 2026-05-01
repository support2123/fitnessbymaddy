const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('./lib/whatsapp');
const { maskPhone, programLabel, corsHeaders } = require('./lib/utils');
const crypto = require('crypto');

function verifyExlySignature(body, signature) {
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
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, email, name, checkout_id, amount,
      product_name, status: paymentStatus,
    } = req.body || {};

    if (!phone || paymentStatus !== 'completed') {
      return res.status(400).json({ error: 'Invalid payment data' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || '12wk';
    const programWeeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
    const weeks = programWeeks[program] || 12;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const folderPath = `clients/${checkout_id || Date.now()}`;

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount || 0,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (clientErr) {
      console.error('[Exly] Client insert error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const templateMap = {
      '6wk_gym': 'onboard_6wk', '6wk_home': 'onboard_6wk',
      '12wk': 'onboard_12wk', 'pcos': 'onboard_pcos',
      '40plus': 'onboard_40plus', 'zoom_trial': 'onboard_zoom',
      'zoom_pack': 'onboard_zoom',
    };
    await sendWhatsApp({
      phone,
      templateName: templateMap[program] || 'onboard_general',
      bodyValues: [name || lead?.name || 'there', programLabel(program)],
    });

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
      } catch (genErr) {
        console.error('[Exly] Week-1 program generation failed:', genErr.message);
      }
    }

    console.log(`[Exly] Converted ${maskPhone(phone)} → ${program}, client=${client.id}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[Exly] Error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
