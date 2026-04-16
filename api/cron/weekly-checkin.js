// Runs Sunday 03:30 UTC (== 09:00 IST).
// For each active client: send check-in link; nudge on T+24h / T+48h; escalate after 2 consecutive misses.

const { admin } = require('../_lib/supabase');
const { sendText } = require('../_lib/aisensy');
const { ok, err, cryptoRandomToken, maskPhone } = require('../_lib/utils');
const { campaign, checkinBody } = require('../_lib/templates');
const escalation = require('../_lib/escalation');

module.exports = async (req, res) => {
  // Vercel cron sends a GET with x-vercel-cron header
  if (req.method !== 'GET' && req.method !== 'POST') return err(res, 405, 'method_not_allowed');

  const sb = admin();

  const { data: clients, error } = await sb.from('clients').select('*').eq('status', 'active');
  if (error) return err(res, 500, error.message);

  const stats = { sent: 0, nudged: 0, escalated: 0, skipped: 0 };
  const baseUrl = process.env.PUBLIC_BASE_URL || 'https://fitnessbymaddy.com';

  for (const client of clients || []) {
    const market = client.market || 'GLOBAL';
    const currentWeek = weekSince(client.program_started_at);

    // Get or create the check-in row for this week
    let { data: checkin } = await sb.from('checkins')
      .select('*').eq('client_id', client.id).eq('week_no', currentWeek).maybeSingle();
    if (!checkin) {
      const token = cryptoRandomToken(16);
      const ins = await sb.from('checkins').insert({
        client_id: client.id, week_no: currentWeek, token,
      }).select().single();
      checkin = ins.data;
    }

    const url = `${baseUrl}/checkin?c=${client.id}&w=${currentWeek}&t=${encodeURIComponent(checkin.token || '')}`;

    if (!checkin.form_submitted_at) {
      // First send if created today; otherwise check nudge cadence
      const createdAt = new Date(checkin.created_at);
      const ageHrs = (Date.now() - createdAt.getTime()) / 3600000;

      if (ageHrs < 1) {
        const msg = checkinBody(market, currentWeek, url);
        const r = await sendText({
          to: client.phone, body: msg,
          campaignName: campaign('checkin'),
          userName: client.name || 'there',
          templateParams: [String(currentWeek), url],
          bypassRateLimit: true,
        });
        if (r.sent) stats.sent++;
      } else if (ageHrs >= 24 && ageHrs < 26) {
        // +24h nudge
        const msg = market === 'IN'
          ? `Reminder: Week ${currentWeek} check-in abhi tak nahi mila 🙏 ${url}`
          : `Reminder: Week ${currentWeek} check-in still pending 🙏 ${url}`;
        const r = await sendText({
          to: client.phone, body: msg,
          campaignName: campaign('checkin_nudge') || campaign('checkin'),
          userName: client.name || 'there',
          templateParams: [String(currentWeek), url],
          bypassRateLimit: true,
        });
        if (r.sent) stats.nudged++;
      } else if (ageHrs >= 48 && ageHrs < 50) {
        // +48h final nudge + increment missed counter
        const msg = market === 'IN'
          ? `Last reminder for Week ${currentWeek} check-in — 3 min lagenge: ${url}`
          : `Last reminder for your Week ${currentWeek} check-in — 3 min: ${url}`;
        const r = await sendText({
          to: client.phone, body: msg,
          campaignName: campaign('checkin_nudge') || campaign('checkin'),
          userName: client.name || 'there',
          templateParams: [String(currentWeek), url],
          bypassRateLimit: true,
        });
        if (r.sent) stats.nudged++;

        await sb.from('clients')
          .update({ missed_checkins: (client.missed_checkins || 0) + 1 })
          .eq('id', client.id);

        const missed = (client.missed_checkins || 0) + 1;
        if (missed >= 2) {
          await escalation.raise({
            phone: client.phone, clientId: client.id,
            trigger: 'missed_2_consecutive_checkins',
            detail: `Weeks around ${currentWeek - 1}-${currentWeek}`,
          });
          await escalation.notifyMaddy({
            trigger: 'missed_2_consecutive_checkins',
            phone: maskPhone(client.phone),
            detail: `${client.name || 'Client'} · ${client.program}`,
          });
          stats.escalated++;
        }
      } else {
        stats.skipped++;
      }
    } else {
      stats.skipped++;
    }
  }

  return ok(res, stats);
};

function weekSince(startIso) {
  if (!startIso) return 1;
  const diffMs = Date.now() - new Date(startIso).getTime();
  const week = Math.floor(diffMs / (7 * 86400 * 1000)) + 1;
  return Math.max(1, week);
}
