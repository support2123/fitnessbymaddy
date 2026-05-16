const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, normalizePhone } = require('./lib/whatsapp');

const PROGRAM_MAP = {
  '6_week_shred_gym': '6wk_gym',
  '6_week_shred_home': '6wk_home',
  '12_week_custom': '12wk',
  'pcos_warrior': 'pcos',
  '40_plus_strong': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack'
};

const PROGRAM_WEEKS = {
  '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
  pcos: 6, '40plus': 8, zoom_trial: 1, zoom_pack: 4
};

function verifyWebhook(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();
    const signature = req.headers['x-exly-signature'] || '';
    if (!verifyWebhook(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { phone, name, email, checkout_id, product_key, amount } = req.body;
    if (!phone || !product_key) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const normalizedPhone = normalizePhone(phone);
    const program = PROGRAM_MAP[product_key] || product_key;
    const weeks = PROGRAM_WEEKS[program] || 6;
    const programEnds = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${normalizedPhone}`;

    const { data: client, error: insertErr } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || null,
      email: email || null,
      program,
      program_ends_at: programEnds.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      folder_url: folderPath,
      status: 'active'
    }).select().single();

    if (insertErr) {
      console.error('Client insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [name || 'Champion']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
