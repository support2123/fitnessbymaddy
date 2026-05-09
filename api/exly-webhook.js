const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { detectMarket, PROGRAM_NAMES } = require('../lib/helpers');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const db = getSupabase();
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, lead_id,
    } = req.body;

    if (!customer_phone) {
      return res.status(400).json({ error: 'Missing customer phone' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : `+${customer_phone}`;
    const market = detectMarket(phone);
    const program = mapProductToProgram(product_name);

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
      'pcos': 6, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4,
    };
    const weeks = programWeeks[program] || 6;

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + weeks * 7);

    let resolvedLeadId = lead_id;
    if (!resolvedLeadId) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .limit(1)
        .single();
      resolvedLeadId = lead?.id;
    }

    if (resolvedLeadId) {
      await db.from('leads').update({ status: 'converted' }).eq('id', resolvedLeadId);
    }

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: resolvedLeadId || null,
      phone,
      name: customer_name || null,
      email: customer_email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : null,
      checkout_id: checkout_id || null,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const templateName = market === 'IN'
      ? `onboard_${program}_hi`
      : `onboard_${program}_en`;

    await sendWhatsApp(phone, templateName, [
      customer_name || 'there',
      PROGRAM_NAMES[program] || program,
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
      } catch (genErr) {
        console.error('Week-1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
