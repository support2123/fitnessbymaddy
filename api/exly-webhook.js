const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { escalateToMaddy } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/mask');
const crypto = require('crypto');

const PROGRAM_DURATION_WEEKS = {
  '6wk_gym': 6,
  '6wk_home': 6,
  '12wk': 12,
  'pcos': 8,
  '40plus': 8,
  'zoom_trial': 1,
  'zoom_pack': 4
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto.createHmac('sha256', secret)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, status: paymentStatus
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });
    if (paymentStatus && paymentStatus !== 'completed') {
      if (paymentStatus === 'failed') {
        await escalateToMaddy('Payment failed', `Phone: ${maskPhone(phone)}, Amount: $${amount}`);
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const supabase = getSupabase();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1)
      .single();

    const program = detectProgram(product_name, lead?.program_interest);
    const durationWeeks = PROGRAM_DURATION_WEEKS[program] || 6;
    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + durationWeeks * 7);

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${client.id}/.keep`, new Uint8Array(0), { upsert: true }
    );
    await supabase.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    await sendWhatsApp(phone, `onboard_${program}`, [
      name || 'there',
      durationWeeks.toString()
    ]);

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    console.log(`Converted: ${maskPhone(phone)} → ${program} $${amount}`);
    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName, leadInterest) {
  if (leadInterest) return leadInterest;
  if (!productName) return '6wk_gym';

  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
