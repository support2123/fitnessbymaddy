const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');
const { programLabel, detectMarket, maskPhone, jsonResponse, errorResponse } = require('./_lib/helpers');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  'pcos': 42,
  '40plus': 42,
  '12wk': 84,
  'zoom_trial': 7,
  'zoom_pack': 30
};

function mapExlyProduct(productName) {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return errorResponse(res, 'POST only', 405);

  // Verify webhook signature if secret is set
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const payload = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (signature && signature !== expected) {
      console.error('[Exly] Invalid signature');
      return errorResponse(res, 'Invalid signature', 401);
    }
  }

  const db = getSupabase();
  const body = req.body || {};

  const phone = (body.phone || body.mobile || body.customer_phone || '').replace(/[^0-9+]/g, '').replace(/^(\d)/, '+$1');
  const name = body.name || body.customer_name || '';
  const email = body.email || body.customer_email || '';
  const amount = body.amount || body.paid_amount || 0;
  const checkoutId = body.checkout_id || body.order_id || body.transaction_id || '';
  const productName = body.product_name || body.product || body.plan || '';

  if (!phone) return errorResponse(res, 'No phone number in webhook');

  const program = mapExlyProduct(productName);
  const durationDays = PROGRAM_DURATIONS[program] || 42;
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  console.log(`[Exly] Purchase: ${maskPhone(phone)} -> ${program} ($${amount})`);

  // Find or create lead
  let { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  } else {
    const { data: newLead } = await db.from('leads').insert({
      phone,
      name,
      source: 'exly_purchase',
      status: 'converted',
      market: detectMarket(phone)
    }).select().single();
    lead = newLead;
  }

  // Parse any stored intake data
  let intakeData = {};
  if (lead && lead.first_msg) {
    try { intakeData = JSON.parse(lead.first_msg); } catch {}
  }

  // Create client
  const { data: client } = await db.from('clients').insert({
    lead_id: lead?.id,
    phone,
    name: name || lead?.name || 'Client',
    email: email || intakeData.email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: parseInt(amount) || 0,
    checkout_id: checkoutId,
    status: 'active',
    age: intakeData.age ? parseInt(intakeData.age) : null,
    goal: intakeData.goal || null,
    injuries: intakeData.injuries || null,
    diet_pref: intakeData.diet_pref || null,
    schedule: intakeData.schedule || null
  }).select().single();

  if (!client) {
    return errorResponse(res, 'Failed to create client', 500);
  }

  // Create storage folder
  const folderPath = `${client.id}/.keep`;
  await db.storage.from('clients').upload(folderPath, Buffer.from(''), { upsert: true });
  await db.from('clients').update({ folder_url: `clients/${client.id}/` }).eq('id', client.id);

  // Send onboarding message
  const market = detectMarket(phone);
  const isHinglish = market === 'IN';
  const label = programLabel(program);

  const onboardMsg = isHinglish
    ? `Welcome to ${label}! 🎉\n\nTera program shuru ho chuka hai. Here's what happens next:\n\n1️⃣ Week 1 ka plan aa raha hai\n2️⃣ Har Sunday check-in form aayega\n3️⃣ Questions? Yahaan message kar\n\nLet's gooo! 💪`
    : `Welcome to ${label}! 🎉\n\nYour program has officially started. Here's what happens next:\n\n1️⃣ Your Week 1 plan is being generated\n2️⃣ Every Sunday you'll receive a check-in form\n3️⃣ Questions? Message us right here\n\nLet's go! 💪`;

  await sendText(phone, onboardMsg);

  // For 12-week program, trigger immediate Week 1 generation
  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('[Exly] Failed to trigger program generation:', err.message);
    }
  }

  return jsonResponse(res, {
    ok: true,
    client_id: client.id,
    program
  });
};
