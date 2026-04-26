const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp, maskPhone } = require('../lib/whatsapp');
const { logMessage } = require('../lib/messages');
const { PROGRAM_NAMES } = require('../lib/helpers');

function verifyExlySignature(body, signature, secret) {
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
  return hash === signature;
}

function programEndDate(program, startDate) {
  const d = new Date(startDate);
  if (program === '12wk') d.setDate(d.getDate() + 84);
  else if (program.startsWith('6wk')) d.setDate(d.getDate() + 42);
  else d.setDate(d.getDate() + 30);
  return d.toISOString();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || '';
  if (!verifyExlySignature(req.body, signature, process.env.EXLY_WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const {
    phone,
    email,
    name,
    amount,
    checkout_id,
    product_name,
    lead_id,
  } = req.body;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const db = getSupabase();

  // Determine program from product name or lead's interest
  let program = null;
  if (product_name) {
    const pn = product_name.toLowerCase();
    if (pn.includes('12') || pn.includes('flagship') || pn.includes('custom')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40')) program = '40plus';
    else if (pn.includes('trial') || pn.includes('zoom')) program = 'zoom_trial';
    else if (pn.includes('home')) program = '6wk_home';
    else program = '6wk_gym';
  }

  if (!program && lead_id) {
    const { data: lead } = await db.from('leads').select('program_interest').eq('id', lead_id).maybeSingle();
    if (lead) program = lead.program_interest || '6wk_gym';
  }
  if (!program) program = '6wk_gym';

  const now = new Date().toISOString();

  // Update lead status
  if (lead_id) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead_id);
  } else {
    await db.from('leads').update({ status: 'converted' }).eq('phone', phone);
  }

  // Check for existing client
  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .maybeSingle();

  let clientId;

  if (existing) {
    await db.from('clients').update({
      name: name || undefined,
      email: email || undefined,
      program,
      program_started_at: now,
      program_ends_at: programEndDate(program, now),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id,
      status: 'active',
    }).eq('id', existing.id);
    clientId = existing.id;
  } else {
    const { data: client } = await db.from('clients').insert({
      lead_id: lead_id || null,
      phone,
      name,
      email,
      program,
      program_started_at: now,
      program_ends_at: programEndDate(program, now),
      paid_amount: amount ? parseInt(amount) : 0,
      checkout_id,
      status: 'active',
    }).select().single();
    clientId = client.id;
  }

  // Create storage folder
  const folderPath = `clients/${clientId}/.keep`;
  await db.storage.from('client-files').upload(folderPath, new Uint8Array(0), {
    upsert: true,
    contentType: 'application/octet-stream',
  });

  await db.from('clients').update({
    folder_url: `clients/${clientId}/`,
  }).eq('id', clientId);

  // Send onboarding WhatsApp
  const programLabel = PROGRAM_NAMES[program] || program;
  try {
    await sendWhatsApp(phone, `onboard_${program}`, [name || 'there', programLabel]);
    await logMessage(phone, 'out', `Welcome to ${programLabel}!`, `onboard_${program}`);
  } catch (err) {
    console.error(`Onboard msg failed for ${maskPhone(phone)}:`, err.message);
  }

  // For 12-week: trigger immediate program generation
  if (program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id: clientId, week_no: 1 }),
      });
    } catch (err) {
      console.error(`Program gen trigger failed for ${maskPhone(phone)}:`, err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: clientId, program });
};
