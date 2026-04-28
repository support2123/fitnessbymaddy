const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify webhook signature if secret is configured
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

  try {
    const {
      customer_phone, customer_name, customer_email,
      product_name, amount, checkout_id, payment_status
    } = req.body;

    if (payment_status && payment_status !== 'completed' && payment_status !== 'success') {
      // Payment failed — escalate if active client
      const { data: existingClient } = await db
        .from('clients')
        .select('id, name, phone')
        .eq('phone', customer_phone)
        .eq('status', 'active')
        .limit(1);

      if (existingClient && existingClient.length > 0) {
        const { escalateToMaddy } = require('./_lib/escalation');
        await escalateToMaddy({
          reason: 'Payment failure for active client',
          phone: customer_phone,
          clientName: customer_name,
          message: `Payment of $${amount} failed. Checkout: ${checkout_id}`
        });
      }
      return res.status(200).json({ action: 'payment_failed_logged' });
    }

    const phone = customer_phone.startsWith('+') ? customer_phone : '+' + customer_phone;
    const program = mapProductToProgram(product_name);
    const market = detectMarket(phone);
    const hinglish = isHinglish(market);

    // Find or create lead
    let { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!lead) {
      const { data: newLead } = await db.from('leads').insert({
        phone,
        name: customer_name,
        source: 'exly',
        status: 'converted',
        market
      }).select().single();
      lead = newLead;
    } else {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    // Calculate program dates
    const startDate = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    // Create client
    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead.id,
      phone,
      name: customer_name || lead.name,
      email: customer_email,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    // Create Storage folder
    const folderPath = `clients/${client.id}/.keep`;
    await db.storage
      .from('client-files')
      .upload(folderPath, Buffer.from(''), { upsert: true });

    await db.from('clients').update({
      folder_url: `clients/${client.id}/`
    }).eq('id', client.id);

    // Send onboarding WhatsApp
    const onboardMsg = hinglish
      ? `Welcome to the family, ${customer_name || 'champ'}! Aapka ${program} program start ho gaya hai.\n\nDay 7 pe aapko pehla check-in form milega. Tab tak — full dedication!`
      : `Welcome aboard, ${customer_name || 'champ'}! Your ${program} program has officially started.\n\nYou'll receive your first check-in form on Day 7. Until then — go all in!`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: onboardMsg,
      params: [customer_name || 'there']
    });

    // For 12-week program: generate Week 1 immediately
    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') || lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}
