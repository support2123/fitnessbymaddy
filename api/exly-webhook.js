const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { parseBody, handleCors, maskPhone, getProgramMeta, detectMarket, getLanguage } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);

  // Verify webhook signature if secret is set
  if (process.env.EXLY_WEBHOOK_SECRET) {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');

    if (signature && signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const {
    phone,
    email,
    name,
    amount,
    checkout_id,
    product_name,
    status
  } = body;

  if (!phone || status !== 'paid') {
    return res.status(200).json({ action: 'ignored', reason: 'not a paid event or missing phone' });
  }

  const db = getSupabase();

  // Find the lead
  const { data: leads } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1);

  const lead = leads?.[0];
  const program = lead?.program_interest || mapProductToProgram(product_name);

  if (!program) {
    return res.status(200).json({ action: 'ignored', reason: 'unknown program' });
  }

  // Update lead status
  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const meta = getProgramMeta(program);
  const programEndsAt = meta
    ? new Date(Date.now() + meta.duration_weeks * 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;

  // Check if client already exists (avoid duplicate on webhook retry)
  const { data: existingClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('checkout_id', checkout_id || '')
    .limit(1);

  if (existingClient && existingClient.length > 0) {
    return res.status(200).json({ action: 'already_processed', client_id: existingClient[0].id });
  }

  // Check if there's a pre-client from intake form
  const { data: preClient } = await db
    .from('clients')
    .select('*')
    .eq('phone', phone)
    .eq('paid_amount', 0)
    .limit(1);

  let clientId;

  if (preClient && preClient.length > 0) {
    // Update existing pre-client
    await db.from('clients').update({
      status: 'active',
      paid_amount: amount || (meta ? meta.price * 100 : 0),
      checkout_id: checkout_id || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt,
      name: name || preClient[0].name,
      email: email || preClient[0].email
    }).eq('id', preClient[0].id);
    clientId = preClient[0].id;
  } else {
    // Create new client
    const { data: newClient } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || null,
      email: email || null,
      program,
      status: 'active',
      paid_amount: amount || (meta ? meta.price * 100 : 0),
      checkout_id: checkout_id || null,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEndsAt
    }).select().single();
    clientId = newClient?.id;
  }

  // Create storage folder reference
  const folderUrl = `/clients/${clientId}/`;
  await db.from('clients').update({ folder_url: folderUrl }).eq('id', clientId);

  // Send onboarding WhatsApp
  const market = detectMarket(phone);
  const lang = getLanguage(market);
  const templateName = `onboard_${program}`;

  await sendTemplate(phone, templateName, [
    name || 'there',
    meta?.name || program,
    `${meta?.duration_weeks || 6} weeks`
  ]);

  // For 12-week program, trigger immediate Week 1 generation
  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host || 'www.fitnessbymaddy.com'}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId })
      });
    } catch (err) {
      console.error('Failed to trigger Week 1 generation:', err.message);
    }
  }

  console.log(`Conversion: ${maskPhone(phone)} → ${program} ($${amount || meta?.price})`);
  return res.status(200).json({ action: 'converted', client_id: clientId, program });
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('6 week') && lower.includes('home')) return '6wk_home';
  if (lower.includes('6 week') || lower.includes('shred')) return '6wk_gym';
  if (lower.includes('12 week') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom') && lower.includes('pack')) return 'zoom_pack';
  return null;
}
