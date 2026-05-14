const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { notifyMaddy } = require('../lib/escalation');

const PROGRAM_MAP = {
  '6wk-shred': { program: '6wk_gym', weeks: 6 },
  '6wk-home': { program: '6wk_home', weeks: 6 },
  'pcos-warrior': { program: 'pcos', weeks: 6 },
  '40plus-strong': { program: '40plus', weeks: 8 },
  '12wk-custom': { program: '12wk', weeks: 12 },
  'zoom-trial': { program: 'zoom_trial', weeks: 1 },
  'zoom-pack': { program: 'zoom_pack', weeks: 4 }
};

function verifySignature(body, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();
  const payload = req.body || {};
  const phone = payload.phone || payload.customer_phone || '';
  const checkoutId = payload.checkout_id || payload.order_id || '';
  const productSlug = payload.product_slug || payload.product || '';
  const amount = payload.amount || payload.paid_amount || 0;
  const customerName = payload.name || payload.customer_name || '';
  const customerEmail = payload.email || payload.customer_email || '';

  if (!phone) return res.status(400).json({ error: 'phone required' });

  const mapping = PROGRAM_MAP[productSlug] || { program: '6wk_gym', weeks: 6 };
  const programEndDate = new Date();
  programEndDate.setDate(programEndDate.getDate() + mapping.weeks * 7);

  const { data: lead } = await db.from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name: customerName || lead?.name || null,
    email: customerEmail,
    program: mapping.program,
    program_started_at: new Date().toISOString(),
    program_ends_at: programEndDate.toISOString(),
    paid_amount: parseInt(amount),
    checkout_id: checkoutId,
    folder_url: null,
    status: 'active'
  }).select().single();

  if (error) {
    console.error('Client insert error:', error);
    return res.status(500).json({ error: 'Failed to create client' });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('client-files').upload(
    `${folderPath}/.keep`,
    '',
    { contentType: 'text/plain', upsert: true }
  );

  await db.from('clients')
    .update({ folder_url: folderPath })
    .eq('id', client.id);

  const templateName = `onboard_${mapping.program}`;
  await sendTemplate(phone, templateName, [
    client.name || 'there',
    String(mapping.weeks)
  ]);

  if (mapping.program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (e) {
      console.error('Week-1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ ok: true, client_id: client.id });
};
