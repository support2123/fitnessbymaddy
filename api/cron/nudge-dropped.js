import supabase from '../../lib/supabase.js';
import { sendTemplate, canSendMessage } from '../../lib/whatsapp.js';
import { jsonResponse } from '../../lib/helpers.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return jsonResponse(res, { error: 'GET only' }, 405);

  const authHeader = req.headers['authorization'];
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}` || req.headers['x-vercel-cron'];
  if (!isCron && authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return jsonResponse(res, { error: 'Unauthorized' }, 401);
  }

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: droppedLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'dropped')
      .gte('created_at', fourteenDaysAgo)
      .lte('last_msg_at', sevenDaysAgo);

    if (!droppedLeads || droppedLeads.length === 0) {
      return jsonResponse(res, { ok: true, message: 'No eligible leads', nudged: 0 });
    }

    let nudged = 0;

    for (const lead of droppedLeads) {
      const canSend = await canSendMessage(lead.phone);
      if (!canSend) continue;

      await sendTemplate(lead.phone, 'nudge_trial', [
        lead.name || 'there',
      ]);
      nudged++;

      await supabase.from('leads').update({
        last_msg_at: new Date().toISOString(),
      }).eq('id', lead.id);
    }

    return jsonResponse(res, { ok: true, nudged, total: droppedLeads.length });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return jsonResponse(res, { error: 'Cron failed' }, 500);
  }
}
