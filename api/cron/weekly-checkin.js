const { supabase } = require('../../lib/supabase');
const { sendTemplate, canSendMessage } = require('../../lib/whatsapp');
const { checkMissedCheckins } = require('../../lib/escalation');
const { sendJson, maskPhone } = require('../../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_KEY}`;

  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return sendJson(res, 401, { error: 'Unauthorized' });
  }

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .not('program_started_at', 'is', null);

    if (!activeClients || activeClients.length === 0) {
      return sendJson(res, 200, { message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let escalated = 0;

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      const endDate = client.program_ends_at ? new Date(client.program_ends_at) : null;
      if (endDate && Date.now() > endDate.getTime()) continue;

      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      const missedEscalation = await checkMissedCheckins(client.id);
      if (missedEscalation) escalated++;

      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const allowed = await canSendMessage(client.phone, true);
      if (!allowed) {
        skipped++;
        continue;
      }

      await sendTemplate(client.phone, 'weekly_checkin', [
        client.name || 'there',
        String(weekNo),
        checkinUrl,
      ]);

      console.log(`[CRON] Check-in sent to ${maskPhone(client.phone)} for week ${weekNo}`);
      sent++;
    }

    return sendJson(res, 200, {
      success: true,
      total_clients: activeClients.length,
      sent,
      skipped,
      escalated,
    });
  } catch (err) {
    console.error('[CRON-CHECKIN] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};
