const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate, notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone, PROGRAM_NAMES, corsHeaders } = require('./_lib/helpers');

function verifySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature || ''));
}

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'] || '';
  try {
    if (!verifySignature(req.body, signature)) {
      return res.status(401).json({ error: 'invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'signature verification failed' });
  }

  const db = getSupabase();
  const {
    customer_phone, customer_name, customer_email,
    checkout_id, amount, product_name, status
  } = req.body;

  if (status !== 'completed' && status !== 'success') {
    if (status === 'failed') {
      await notifyMaddy('Payment failed', `Phone: ${maskPhone(customer_phone)}, Amount: $${amount}`);
    }
    return res.status(200).json({ action: 'non_success_ignored' });
  }

  const phone = customer_phone?.startsWith('+') ? customer_phone : `+${customer_phone}`;

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  const program = lead?.program_interest || mapProductToProgram(product_name);
  const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 4;
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + programWeeks * 7);

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .single();

  let clientId;
  if (existingClient) {
    await db.from('clients').update({
      program,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id,
      status: 'active',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      name: customer_name || existingClient.name,
      email: customer_email
    }).eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: customer_name || lead?.name,
      email: customer_email,
      program,
      paid_amount: amount ? parseInt(amount, 10) : 0,
      checkout_id,
      status: 'active',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString()
    }).select().single();
    clientId = newClient?.id;
  }

  if (clientId) {
    const folderPath = `clients/${clientId}`;
    await db.from('clients').update({ folder_url: folderPath }).eq('id', clientId);
  }

  const templateName = `onboard_${program || 'general'}`;
  await sendTemplate(phone, templateName, [
    customer_name || 'there',
    PROGRAM_NAMES[program] || product_name || 'your program'
  ]);

  if (program === '12wk' && clientId) {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, week_no: 1 })
      });
    } catch (err) {
      console.error('[Exly] Week-1 generation trigger failed:', err.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: clientId });
};

function mapProductToProgram(productName) {
  if (!productName) return null;
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('shred') || lower.includes('burn') || lower.includes('6')) return '6wk_gym';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  return null;
}
