const { getSupabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { programWeeks } = require('../lib/utils');
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

    const body = req.body;
    const {
      buyer_phone, buyer_name, buyer_email,
      amount, checkout_id, product_name,
    } = body;

    if (!buyer_phone) return res.status(400).json({ error: 'Missing buyer_phone' });

    const db = getSupabase();
    const cleanPhone = buyer_phone.replace(/\D/g, '');

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', cleanPhone)
      .single();

    const leadId = lead?.id || null;
    const program = lead?.program_interest || inferProgram(product_name, amount);
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone: cleanPhone,
      name: buyer_name || lead?.name,
      email: buyer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id: checkout_id || null,
      folder_url: `/clients/${cleanPhone}/`,
      status: 'active',
    }).select().single();

    if (leadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const templateName = `onboard_${program}`;
    await sendTemplate(cleanPhone, templateName, [buyer_name || 'there']);

    if (program === '12wk' && client) {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    await notifyMaddy('Payment webhook error', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
