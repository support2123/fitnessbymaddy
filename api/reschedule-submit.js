// POST /api/reschedule-submit  { client_id, reason, new_date, new_time, notes }
// Logs to messages audit + escalates so Maddy can confirm.
import { db } from './_lib/supabase.js';
import { escalate } from './_lib/escalation.js';
import { readJson } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = await readJson(req);
  const clientId = body.client_id;
  if (!clientId) return res.status(400).json({ ok: false, error: 'client_id required' });

  const supa = db();
  const { data: client } = await supa
    .from('clients').select('phone,name').eq('id', clientId).maybeSingle();
  if (!client) return res.status(404).json({ ok: false, error: 'client not found' });

  await supa.from('messages').insert({
    phone: client.phone, direction: 'in',
    body: 'RESCHEDULE_REQUEST', template_name: 'reschedule_v1',
    meta: {
      reason: body.reason, new_date: body.new_date,
      new_time: body.new_time, notes: body.notes,
    },
  });

  await escalate({
    phone: client.phone, clientId,
    trigger: 'reschedule_request',
    context: `${body.new_date} ${body.new_time} — ${body.reason}. ${body.notes || ''}`.slice(0, 280),
  });

  return res.status(200).json({ ok: true });
}
