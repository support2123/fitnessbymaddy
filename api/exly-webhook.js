const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

function verifySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not a completed purchase' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'No customer phone' });
    }

    const db = getSupabase();

    const program = detectProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: customer_phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(customer_phone, `onboard_${program}`, [
      customer_name || 'there',
      program,
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('zoom') || lower.includes('trial')) return 'zoom_trial';
  return '6wk_gym';
}
