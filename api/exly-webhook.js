const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { maskPhone, weekNumber } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    const secret = process.env.EXLY_WEBHOOK_SECRET;

    if (secret && signature) {
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('phone')
          .eq('phone', customer_phone)
          .single();
        if (lead) {
          const { notifyMaddy } = require('../lib/escalation');
          await notifyMaddy('Payment failed', customer_phone, `Product: ${product_name}`);
        }
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;

    const program = mapExlyProduct(product_name);
    const programWeeks = program === '12wk' ? 12 : program === 'zoom_pack' ? 8 : 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + programWeeks * 7);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${checkout_id || Date.now()}`;

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_ends_at: endsAt.toISOString(),
      paid_amount: Math.round((amount || 0) * 100),
      checkout_id,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(phone, `onboard_${program}`, [
      customer_name || 'there',
      programWeeks.toString(),
    ]);

    if (program === '12wk') {
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
        console.error('Week-1 program trigger failed:', e.message);
      }
    }

    console.log(`Conversion: ${maskPhone(phone)} → ${program}`);
    return res.status(200).json({ ok: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (/12.week|flagship|custom/i.test(lower)) return '12wk';
  if (/pcos/i.test(lower)) return 'pcos';
  if (/40\+|forty|plus/i.test(lower)) return '40plus';
  if (/home/i.test(lower)) return '6wk_home';
  if (/trial|zoom.*trial/i.test(lower)) return 'zoom_trial';
  if (/zoom.*pack|live/i.test(lower)) return 'zoom_pack';
  return '6wk_gym';
}
