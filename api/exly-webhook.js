const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify webhook signature
  const signature = req.headers['x-webhook-signature'] || req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const supabase = getSupabase();
  const payload = req.body;

  const phone = payload.phone || payload.customer_phone;
  const email = payload.email || payload.customer_email;
  const name = payload.name || payload.customer_name;
  const amount = payload.amount || payload.paid_amount;
  const checkoutId = payload.checkout_id || payload.order_id;
  const productSlug = payload.product_slug || payload.product || '';

  if (!phone) {
    return res.status(400).json({ error: 'phone is required' });
  }

  // Determine program from product slug
  const program = mapProductToProgram(productSlug);

  // Find existing lead
  const { data: lead } = await supabase
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  // Update lead status to converted
  if (lead) {
    await supabase.from('leads')
      .update({ status: 'converted' })
      .eq('id', lead.id);
  }

  // Calculate program end date
  const duration = PROGRAM_DURATIONS[program] || 42;
  const programEndsAt = new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString();

  // Create client record
  const { data: client, error } = await supabase
    .from('clients')
    .upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active'
    }, { onConflict: 'phone' })
    .select()
    .single();

  if (error) {
    console.error('Client creation error:', error.message);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  // Create storage folder
  const folderPath = `clients/${client.id}/`;
  await supabase.storage.from('programs').upload(
    `${folderPath}.keep`,
    new Uint8Array(0),
    { contentType: 'application/octet-stream', upsert: true }
  );

  await supabase.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  // Send onboarding WhatsApp
  const onboardMsg = getOnboardMessage(program, name || 'there');
  await sendWhatsApp({
    phone,
    templateName: `onboard_${program}`,
    body: onboardMsg
  });

  // For 12-week program: generate Week 1 immediately
  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week 1 generation failed:', err.message);
    }
  }

  return res.status(200).json({ success: true, client_id: client.id, program });
};

function mapProductToProgram(slug) {
  const lower = (slug || '').toLowerCase();
  if (lower.includes('6wk') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6wk') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('12wk') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return '6wk_gym';
}

function getOnboardMessage(program, name) {
  const messages = {
    '6wk_gym': `Hey ${name}! 🎉 Welcome to the 6 Week Shred! Your program is ready. Here's what happens next:\n\n1️⃣ Check your email for the full workout plan\n2️⃣ Join the private community group\n3️⃣ First check-in is in 7 days\n\nLet's crush it! 💪`,
    '6wk_home': `Hey ${name}! 🎉 Welcome to the 6 Week Home Shred! Same intensity, no gym needed. Check your email for everything you need to start today!`,
    '12wk': `Hey ${name}! 🎉 Welcome to the 12-Week Custom Program — Maddy's flagship! 🔥\n\nYour personalised Week 1 plan is being built right now. You'll receive it within 24 hours.\n\nEvery week you'll get:\n✅ Custom workout plan\n✅ Nutrition guidance\n✅ Check-in form\n\nThis is going to be transformative. Let's go! 💪`,
    'pcos': `Hey ${name}! 🎉 Welcome to PCOS Warrior! A program designed specifically for hormonal balance + sustainable fat loss. Check your email for everything! 💜`,
    '40plus': `Hey ${name}! 🎉 Welcome to 40+ Strong! Smart training for real results — no joint stress, all progress. Your plan is in your email! 🙌`,
    'zoom_trial': `Hey ${name}! 🎉 Your Zoom trial is confirmed! Maddy's team will reach out within 24 hours to schedule your session. Get ready! 🎯`,
    'zoom_pack': `Hey ${name}! 🎉 Your Zoom coaching pack is confirmed! We'll schedule your first session within 24 hours. Exciting times ahead! 🚀`
  };
  return messages[program] || messages['6wk_gym'];
}
