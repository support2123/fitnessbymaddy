const { getSupabase } = require('../lib/supabase');
const { sendTemplate, logMessage } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  pcos: 42,
  '40plus': 42,
  zoom_trial: 7,
  zoom_pack: 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret && req.headers['x-exly-signature']) {
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== req.headers['x-exly-signature']) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      checkout_id,
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      amount,
      status,
    } = req.body;

    if (status !== 'paid' && status !== 'completed') {
      // Payment failure for active client?
      if (status === 'failed') {
        const { notifyMaddy } = require('../lib/whatsapp');
        const { maskPhone } = require('../lib/market');
        await notifyMaddy(
          'Payment failure',
          `Phone: ${maskPhone(customer_phone)}\nName: ${customer_name}\nAmount: ${amount}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No customer phone' });

    // Find matching lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || detectProgramFromProduct(product_name);

    // Update lead to converted
    if (lead) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create client
    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active',
    }).select().single();

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    await db.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    // Send onboarding template
    const market = lead?.market || 'GLOBAL';
    const templateName = isHinglish(market)
      ? `onboard_${program}_hi`
      : `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);
    await logMessage(phone, 'out', null, templateName);

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });

  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgramFromProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
