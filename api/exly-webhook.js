const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { sendClientMessage, notifyMaddy } = require('../lib/whatsapp');
const { detectMarket } = require('../lib/market');

const PRODUCT_TO_PROGRAM = {
  '6-week-shred-gym': '6wk_gym',
  '6-week-shred-home': '6wk_home',
  '6wk-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  '12-week-flagship': '12wk',
  '12wk-flagship': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature if secret is configured
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'] || '';
      const payload = JSON.stringify(req.body);
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const data = req.body.data || req.body;
    const phone = data.customer_phone || data.phone || '';
    const email = data.customer_email || data.email || '';
    const name = data.customer_name || data.name || '';
    const amount = data.amount || data.paid_amount || 0;
    const checkoutId = data.checkout_id || data.order_id || '';
    const productSlug = data.product_slug || data.product_name || '';

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone number' });
    }

    const program = PRODUCT_TO_PROGRAM[productSlug.toLowerCase()] || '6wk_gym';
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    // Find or create lead
    let { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone,
          name,
          source: 'exly',
          status: 'converted',
          market: detectMarket(phone),
        })
        .select()
        .single();
      lead = newLead;
    } else {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    // Create client record
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone,
        name: name || lead.name,
        email,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: Math.round(parseFloat(amount) * 100),
        checkout_id: checkoutId,
        folder_url: `/clients/${lead.id}/`,
        status: 'active',
      })
      .select()
      .single();

    if (clientError) throw clientError;

    // Create storage folder placeholder
    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage
      .from('clients')
      .upload(folderPath, new Uint8Array(0), { upsert: true });

    // Send onboarding WhatsApp message
    await sendClientMessage(phone, `onboard_${program}`, [
      name || 'there',
      `${durationDays / 7} weeks`,
    ], name);

    // For 12-week program, trigger immediate Week 1 generation
    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week 1 generation trigger failed:', err.message));
    }

    // Notify Maddy of new sale
    await notifyMaddy(
      'New Sale!',
      `${name} purchased ${program} for $${(amount / 1).toFixed(0)}`
    );

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
