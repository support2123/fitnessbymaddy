const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish, detectMarket } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  pcos: 42,
  '40plus': 42,
  '12wk': 84,
  zoom_trial: 7,
  zoom_pack: 30
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify webhook signature
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'];
      if (signature) {
        const expected = crypto
          .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
        if (signature !== expected) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
      }
    }

    const db = getSupabase();
    const {
      customer_phone,
      customer_name,
      customer_email,
      product_name,
      checkout_id,
      amount,
      status
    } = req.body;

    if (status !== 'completed' && status !== 'success' && status !== 'paid') {
      // Payment failure — check if active client
      if (customer_phone) {
        const { data: client } = await db
          .from('clients')
          .select('id')
          .eq('phone', normalizePhone(customer_phone))
          .eq('status', 'active')
          .single();

        if (client) {
          const { createEscalation } = require('../lib/escalation');
          await createEscalation(
            normalizePhone(customer_phone),
            'Payment failure for active client',
            `Payment failed: ${product_name}, amount: ${amount}`
          );
        }
      }
      return res.status(200).json({ action: 'payment_not_completed' });
    }

    const phone = normalizePhone(customer_phone);
    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    // Determine program from product name
    const program = mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Find or update lead
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Create client record
    const { data: newClient, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (clientErr) {
      console.error('Client creation error:', clientErr.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    // Create storage folder path
    const folderPath = `clients/${newClient.id}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', newClient.id);

    // Send onboarding WhatsApp
    const market = lead?.market || detectMarket(phone);
    const templateName = isHinglish(market) ? `onboard_${program}_hi` : `onboard_${program}`;
    await sendTemplate(phone, templateName, [customer_name || 'there']);

    // Trigger Week 1 program generation for 12-week clients
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: newClient.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: newClient.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(raw) {
  if (!raw) return null;
  let phone = String(raw).replace(/[^0-9+]/g, '');
  if (!phone.startsWith('+')) phone = '+' + phone;
  return phone;
}

function mapProductToProgram(productName) {
  if (!productName) return 'zoom_trial';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('shred') || lower.includes('6') || lower.includes('burn')) return '6wk_gym';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return 'zoom_trial';
}
