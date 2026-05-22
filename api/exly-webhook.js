const crypto = require('crypto');
const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

const PROGRAM_MAP = {
  '6wk-burn-build-gym': '6wk_gym',
  '6wk-burn-build-home': '6wk_home',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

function programDuration(program) {
  const weeks = {
    '6wk_gym': 6,
    '6wk_home': 6,
    '12wk': 12,
    pcos: 8,
    '40plus': 8,
    zoom_trial: 1,
    zoom_pack: 4,
  };
  return weeks[program] || 6;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const sig = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, sig)) {
      return res.status(401).json({ error: 'invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_slug,
      checkout_id,
      amount,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not a completed payment' });
    }

    const phone = (customer_phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'missing phone' });

    const program = PROGRAM_MAP[product_slug] || '6wk_gym';
    const durationWeeks = programDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const folderPath = `clients/${phone}`;

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone,
        name: customer_name || null,
        email: customer_email || null,
        program,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount || 0,
        checkout_id: checkout_id || null,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('client insert error:', clientErr.message);
      return res.status(500).json({ error: 'failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      durationWeeks.toString(),
    ]);

    if (program === '12wk') {
      const generateUrl = `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(() => {});
    }

    return res.status(200).json({
      action: 'converted',
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'internal error' });
  }
};
