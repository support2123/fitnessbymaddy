const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { getProgramDuration } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const sig = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && sig) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id, customer_name, customer_email, customer_phone,
      product_name, amount, status
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      if (status === 'failed') {
        const { data: lead } = await supabase
          .from('leads')
          .select('phone')
          .eq('phone', customer_phone)
          .single();
        if (lead) {
          await supabase.from('escalations').insert({
            phone: customer_phone,
            reason: 'payment_failed',
            message_body: `Payment failed for ${product_name}`
          });
          await sendTemplate(process.env.MADDY_PHONE, 'escalation_alert', [
            customer_name || 'Unknown', 'Payment failed'
          ]);
        }
      }
      return res.status(200).json({ action: 'skipped', status });
    }

    const program = mapExlyProduct(product_name);
    const durationDays = getProgramDuration(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', customer_phone)
      .single();

    let clientId;
    if (existingClient) {
      await supabase.from('clients').update({
        program, paid_amount: amount, checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: 'active',
        name: customer_name,
        email: customer_email
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({
        lead_id: lead?.id,
        phone: customer_phone,
        name: customer_name,
        email: customer_email,
        program,
        paid_amount: amount,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: 'active'
      }).select().single();
      clientId = newClient.id;
    }

    await supabase.storage
      .from('clients')
      .upload(`${clientId}/.keep`, '', { upsert: true });

    const templateName = `onboard_${program}`;
    await sendTemplate(customer_phone, templateName, [customer_name || 'there']);

    if (program === '12wk') {
      const generateUrl = `https://${req.headers.host}/api/generate-program`;
      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      }).catch(() => {});
    }

    return res.status(200).json({ ok: true, client_id: clientId });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
