import { getSupabase } from './_lib/supabase.js';
import { sendWhatsApp, maskPhone } from './_lib/whatsapp.js';
import { handleCors, parseBody } from './_lib/utils.js';

const MADDY_PHONE = '+917082478374';

export default async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();
  const data = parseBody(req);

  const phone = data.phone || '';
  const preferredDate = data.preferred_date || '';
  const preferredTime = data.preferred_time || '';
  const reason = data.reason || 'No reason given';

  if (!phone || !preferredDate || !preferredTime) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: client } = await db
    .from('clients')
    .select('name')
    .eq('phone', phone)
    .eq('status', 'active')
    .limit(1)
    .single();

  await sendWhatsApp(MADDY_PHONE, 'reschedule_request', [
    client?.name || maskPhone(phone),
    preferredDate,
    preferredTime,
    reason
  ]);

  await db.from('messages').insert({
    phone,
    direction: 'in',
    body: `Reschedule request: ${preferredDate} at ${preferredTime}. Reason: ${reason}`
  });

  return res.json({ ok: true });
}
