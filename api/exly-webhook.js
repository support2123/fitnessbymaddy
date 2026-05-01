const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { cors, programDurationDays, detectMarket, isHinglishMarket } = require('./_lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const body = req.body;
    const phone = body.phone || body.customer_phone || body.mobile;
    const email = body.email || body.customer_email;
    const name = body.name || body.customer_name;
    const program = mapExlyProduct(body.product_name || body.product || body.item);
    const paidAmount = body.amount ? Math.round(parseFloat(body.amount) * 100) : 0;
    const checkoutId = body.order_id || body.checkout_id || body.transaction_id;

    if (!phone || !program) {
      return res.status(400).json({ error: 'Missing phone or product info' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = null;
    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
      leadId = lead.id;
    } else {
      const market = detectMarket(phone);
      const { data: newLead } = await db.from('leads').insert({
        phone, name, source: 'exly_purchase',
        status: 'converted', market
      }).select().single();
      leadId = newLead.id;
    }

    const durationDays = programDurationDays(program);
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name,
      email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: paidAmount,
      checkout_id: checkoutId,
      folder_url: `/clients/${leadId}/`,
      status: 'active'
    }).select().single();

    const market = lead ? lead.market : detectMarket(phone);
    const templateName = isHinglishMarket(market)
      ? `onboard_${program}`
      : `onboard_${program}_en`;

    await sendTemplate(phone, templateName, [name || 'there']);

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
      } catch (err) {
        console.error('Week-1 program generation failed:', err.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapExlyProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos') || lower.includes('hormonal')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  return '6wk_gym';
}
