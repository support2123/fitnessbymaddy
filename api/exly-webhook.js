const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket, programWeeks, maskPhone } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (sig) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, transaction_id, checkout_id
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer_phone' });
    }

    const phone = customer_phone.replace(/\D/g, '');
    const program = mapExlyProduct(product_name);
    const market = detectMarket(phone);
    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkout_id || transaction_id,
      folder_url: `clients/${phone}/`,
      status: 'active'
    }).select().single();

    if (error) throw error;

    await sendTemplate(phone, `onboard_${program}`, [customer_name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);

    if (err.message?.includes('duplicate') || err.code === '23505') {
      return res.status(200).json({ ok: true, note: 'duplicate' });
    }

    await notifyMaddy(
      'Payment webhook failed',
      `Error: ${err.message}\nBody: ${JSON.stringify(req.body).slice(0, 200)}`
    ).catch(() => {});

    return res.status(500).json({ error: 'Internal server error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return '6wk_gym';
}
