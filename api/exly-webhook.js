import { getSupabase } from './_lib/supabase.js';
import { sendWhatsApp } from './_lib/whatsapp.js';
import { handleCors, parseBody, PROGRAM_NAMES, programWeeks } from './_lib/utils.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'] || '';
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const db = getSupabase();

  const phone = body.phone || body.customer_phone || '';
  const email = body.email || body.customer_email || '';
  const name = body.name || body.customer_name || '';
  const checkoutId = body.checkout_id || body.order_id || '';
  const paidAmount = body.amount || body.paid_amount || 0;
  const programRaw = body.program || body.product_name || '';

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const program = lead?.program_interest || mapExlyProgram(programRaw);
  const weeks = programWeeks(program);
  const endsAt = new Date();
  endsAt.setDate(endsAt.getDate() + weeks * 7);

  await db.from('leads').update({ status: 'converted' }).eq('phone', phone);

  const { data: client, error } = await db.from('clients').insert({
    lead_id: lead?.id || null,
    phone,
    name,
    email,
    program,
    paid_amount: paidAmount,
    checkout_id: checkoutId,
    program_ends_at: endsAt.toISOString(),
    folder_url: `clients/${lead?.id || 'unknown'}/`,
    status: 'active'
  }).select().single();

  if (error) return res.status(500).json({ error: 'Failed to create client' });

  await sendWhatsApp(phone, `onboard_${program}`, [
    name || 'there',
    PROGRAM_NAMES[program] || program
  ]);

  if (program === '12wk') {
    try {
      const baseUrl = `https://${req.headers.host}`;
      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    } catch (err) {
      console.error('Week 1 generation trigger failed:', err.message);
    }
  }

  return res.json({ ok: true, client_id: client.id });
}

function mapExlyProgram(name) {
  const lower = (name || '').toLowerCase();
  if (lower.includes('12') || lower.includes('custom') || lower.includes('flagship')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
