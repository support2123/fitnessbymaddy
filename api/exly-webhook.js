import { getSupabase } from './_lib/supabase.js';
import { sendClientMessage } from './_lib/whatsapp.js';
import { normalizePhone, programDisplayName } from './_lib/utils.js';
import crypto from 'crypto';

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
  if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const db = getSupabase();

  try {
    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.mobile || payload.customer_phone || '');
    const email = payload.email || payload.customer_email || '';
    const name = payload.name || payload.customer_name || '';
    const checkoutId = payload.checkout_id || payload.order_id || payload.transaction_id || '';
    const amount = payload.amount || payload.paid_amount || 0;
    const productName = (payload.product_name || payload.item_name || '').toLowerCase();

    if (!phone) return res.status(400).json({ error: 'No phone in payload' });

    let program = '6wk_gym';
    if (/pcos/.test(productName)) program = 'pcos';
    else if (/40|forty|plus/.test(productName)) program = '40plus';
    else if (/12|twelve|custom|flagship/.test(productName)) program = '12wk';
    else if (/home/.test(productName)) program = '6wk_home';
    else if (/trial|zoom/.test(productName)) program = 'zoom_trial';
    else if (/pack/.test(productName)) program = 'zoom_pack';

    const { data: lead } = await db.from('leads')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programStart = new Date();
    const weekCount = program === '12wk' ? 12 : 6;
    const programEnd = new Date(programStart.getTime() + weekCount * 7 * 24 * 60 * 60 * 1000);

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email,
      program,
      program_started_at: programStart.toISOString(),
      program_ends_at: programEnd.toISOString(),
      paid_amount: parseFloat(amount),
      checkout_id: checkoutId,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await db.storage.from('programs').upload(
      `${folderPath}/.keep`,
      new Blob([''], { type: 'text/plain' })
    );

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const displayName = programDisplayName(program);
    await sendClientMessage(phone, `onboard_${program}`, [
      name || 'there',
      displayName
    ]);

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `Welcome! You're now enrolled in ${displayName}. Let's crush it!`,
      template_name: `onboard_${program}`,
      status: 'sent'
    });

    if (program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      }).catch(err => console.error('Week-1 generation trigger failed:', err.message));
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
