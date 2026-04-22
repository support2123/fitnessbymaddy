const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { cors, programDuration } = require('./_lib/helpers');
const crypto = require('crypto');

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

const EXLY_TO_PROGRAM = {
  '6wk_gym': '6wk_gym',
  '6wk_home': '6wk_home',
  '12wk': '12wk',
  'pcos': 'pcos',
  '40plus': '40plus',
  'zoom_trial': 'zoom_trial',
  'zoom_pack': 'zoom_pack',
  '6-week-burn-build': '6wk_gym',
  '12-week-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40-plus-strong': '40plus',
  'zoom-trial': 'zoom_trial'
};

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  if (!verifySignature(req.body, sig)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }

  const db = getSupabase();
  const b = req.body || {};

  const phone = b.phone || b.mobile || b.customer_phone || '';
  const email = b.email || b.customer_email || '';
  const name = b.name || b.customer_name || '';
  const rawProgram = b.product_id || b.product_name || b.program || '';
  const program = EXLY_TO_PROGRAM[rawProgram] || EXLY_TO_PROGRAM[rawProgram.toLowerCase()] || '6wk_gym';
  const amount = b.amount || b.paid_amount || 0;
  const checkoutId = b.checkout_id || b.order_id || '';

  if (!phone) return res.status(400).json({ error: 'missing phone' });

  const { data: lead } = await db
    .from('leads')
    .select('id')
    .eq('phone', phone)
    .single();

  const now = new Date();
  const endsAt = new Date(now.getTime() + programDuration(program) * 24 * 60 * 60 * 1000);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name,
    email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: parseInt(amount, 10),
    checkout_id: checkoutId,
    folder_url: `/clients/${lead?.id || 'unknown'}/`,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('[Exly] Client insert error:', error.message);
    return res.status(500).json({ error: 'save_failed' });
  }

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  await sendTemplate(phone, `onboard_${program}`, [
    name || 'there',
    program
  ]);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('[Exly] Week-1 program gen failed:', err.message);
    }
  }

  return res.json({ ok: true, client_id: client.id });
};
