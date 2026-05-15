const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { PROGRAM_DURATIONS_WEEKS, PROGRAM_NAMES, detectMarket, isHinglish } = require('./lib/helpers');
const { escalateToMaddy } = require('./lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Verify webhook signature
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const rawBody = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, product_name, amount, checkout_id, status } = req.body;

    if (status !== 'completed' && status !== 'success') {
      // Payment failed — escalate if active client
      if (status === 'failed') {
        await escalateToMaddy('Payment failure', `Phone: ${phone}, Product: ${product_name}`);
      }
      return res.status(200).json({ action: 'non_completed_status' });
    }

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const db = getSupabase();

    // Map Exly product to internal program key
    const program = mapExlyProduct(product_name);

    // Find or create lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id;

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program end date
    const weeks = PROGRAM_DURATIONS_WEEKS[program] || 6;
    const endsAt = new Date(Date.now() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString();

    // Create client
    const { data: client, error: clientErr } = await db
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || lead?.name,
        email,
        program,
        paid_amount: amount ? parseInt(amount, 10) : null,
        checkout_id,
        program_ends_at: endsAt,
        status: 'active',
      })
      .select()
      .single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder
    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      new Uint8Array(0),
      { contentType: 'application/octet-stream', upsert: true }
    );

    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    // Send onboarding WhatsApp
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);
    const programName = PROGRAM_NAMES[program] || program;

    const onboardParams = hinglish
      ? [`Welcome to ${programName}! 🎉 Tera journey shuru ho gaya hai. Pehla check-in Day 7 pe aayega. Koi bhi question ho toh yahan pooch lena!`]
      : [`Welcome to ${programName}! 🎉 Your journey starts now. Your first check-in will be on Day 7. Feel free to ask any questions here!`];

    await sendWhatsApp(phone, `onboard_${program}`, onboardParams);

    // For 12-week: trigger immediate Week 1 program generation
    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ action: 'converted', client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
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
  if (lower.includes('zoom') || lower.includes('1-on-1') || lower.includes('vip')) return 'zoom_pack';
  return '6wk_gym';
}
