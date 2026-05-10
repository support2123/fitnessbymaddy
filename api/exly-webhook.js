const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const computed = crypto.createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature && signature !== computed) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customerPhone, customerName, customerEmail,
      productName, amount, checkoutId, orderId
    } = req.body;

    const phone = customerPhone;
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const program = mapExlyProduct(productName);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 86400000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1);

    const leadId = lead && lead.length > 0 ? lead[0].id : null;

    if (leadId) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', leadId);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: customerName,
      email: customerEmail,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : 0,
      checkout_id: checkoutId || orderId,
      folder_url: `/clients/${leadId || 'unknown'}/`,
      status: 'active'
    }).select().single();

    await sendTemplate(phone, `onboard_${program}`, [customerName || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client.id, program });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    if (err.message.includes('payment') || err.message.includes('fail')) {
      await notifyMaddy('Payment webhook error', err.message);
    }
    return res.status(500).json({ error: 'Internal error' });
  }
};
