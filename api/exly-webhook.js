const { supabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    const phone = payload.customer_phone || payload.phone || payload.mobile;
    const name = payload.customer_name || payload.name;
    const email = payload.customer_email || payload.email;
    const checkoutId = payload.checkout_id || payload.order_id || payload.transaction_id;
    const amount = payload.amount || payload.paid_amount;
    const productName = payload.product_name || payload.item_name || '';

    if (!phone) return res.status(400).json({ error: 'No phone number in payload' });

    const program = mapProductToProgram(productName);
    const durationDays = PROGRAM_DURATION[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: insertErr } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name,
        email,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id: checkoutId,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    await supabase.storage
      .from('clients')
      .upload(`${client.id}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
        upsert: true
      });

    const market = detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}_en`;

    await sendTemplate(phone, templateName, {
      name: name || 'there',
      templateParams: [name || 'there', program, startDate.toLocaleDateString()]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week 1 program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
