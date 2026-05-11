const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { programLabel, json, parseBody } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, { ok: true });
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const body = await parseBody(req);

  // Verify webhook signature if secret is configured
  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature !== expected) {
      return json(res, { error: 'invalid signature' }, 401);
    }
  }

  const {
    customer_phone, customer_name, customer_email,
    product_name, amount, checkout_id, status
  } = body;

  if (status !== 'completed' && status !== 'success') {
    // Payment failed — notify Maddy for active clients
    if (status === 'failed') {
      await sendWhatsApp(process.env.MADDY_PHONE || '+917082478374', 'escalation_alert', {
        name: 'Maddy',
        templateParams: [
          customer_name || customer_phone,
          `Payment FAILED for ${product_name || 'unknown program'}`,
          new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        ],
      });
    }
    return json(res, { action: 'ignored', status });
  }

  const phone = customer_phone;
  if (!phone) return json(res, { error: 'no phone' }, 400);

  const db = getSupabase();

  // Map Exly product to program code
  const program = mapProduct(product_name);
  const programWeeks = program === '12wk' ? 12 : 6;
  const now = new Date();
  const endsAt = new Date(now);
  endsAt.setDate(endsAt.getDate() + programWeeks * 7);

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
      program_interest: program,
    }).select().single();
    lead = newLead;
  } else {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  // Create client
  const { data: client } = await db.from('clients').insert({
    lead_id: lead.id,
    phone,
    name: customer_name || lead.name,
    email: customer_email,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: amount ? parseInt(amount, 10) : null,
    checkout_id,
    folder_url: `/clients/${lead.id}/`,
    status: 'active',
  }).select().single();

  // Create storage folder with a placeholder
  await db.storage.from('clients').upload(
    `${client.id}/.folder`,
    'created',
    { contentType: 'text/plain', upsert: true }
  );

  // Send onboarding WhatsApp
  await sendWhatsApp(phone, `onboard_${program}`, {
    name: customer_name || 'there',
    templateParams: [
      customer_name || 'there',
      programLabel(program),
      `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=1`,
    ],
  });

  // For 12-week program: generate Week-1 program immediately
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
    } catch (e) {
      // async generation; failure logged there
    }
  }

  return json(res, { ok: true, client_id: client.id });
};

function mapProduct(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos') || lower.includes('warrior')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('zoom') && lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
