// Daily 05:00 UTC. Re-engage leads dropped 7+ days ago (once), and auto-drop stale leads.

const { admin } = require('../_lib/supabase');
const { sendText } = require('../_lib/aisensy');
const { ok, err, hoursAgo, daysAgo } = require('../_lib/utils');
const { campaign } = require('../_lib/templates');
const { trialUrl } = require('../_lib/router');

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') return err(res, 405, 'method_not_allowed');

  const sb = admin();
  const stats = { auto_dropped: 0, re_engaged: 0 };

  // Auto-drop: status=new AND last_msg_at <= 24h ago AND nudge_count>=1
  const cutoff24h = hoursAgo(24).toISOString();
  const { data: stale } = await sb.from('leads').select('id,phone,nudge_count')
    .eq('status', 'new').lte('last_msg_at', cutoff24h);
  for (const l of stale || []) {
    if ((l.nudge_count || 0) >= 1) {
      await sb.from('leads').update({ status: 'dropped' }).eq('id', l.id);
      stats.auto_dropped++;
    }
  }

  // 2-hr nudge for new leads that didn't reply
  const cutoff2h = hoursAgo(2).toISOString();
  const { data: noReply } = await sb.from('leads').select('*')
    .eq('status', 'new').eq('opted_out', false)
    .lte('last_msg_at', cutoff2h).lt('nudge_count', 1);
  for (const l of noReply || []) {
    const market = l.market || 'GLOBAL';
    const nb = market === 'IN'
      ? `Abhi sure nahi? Ek $20 Zoom trial try karo — Maddy ke saath 30-min live session. ${trialUrl() || ''}`
      : `Still thinking? Try a $20 Zoom trial — 30-min live with Maddy. ${trialUrl() || ''}`;
    const r = await sendText({
      to: l.phone, body: nb,
      campaignName: campaign('nudge_trial'),
      userName: l.name || 'there',
      templateParams: [nb],
    });
    if (r.sent) {
      await sb.from('leads').update({ nudge_count: (l.nudge_count || 0) + 1 }).eq('id', l.id);
      stats.re_engaged++;
    }
  }

  // Re-engage: dropped 7 days ago, not opted out, not re-engaged before (nudge_count<=1)
  const cutoff7d = daysAgo(7).toISOString();
  const cutoff8d = daysAgo(8).toISOString();
  const { data: dropped } = await sb.from('leads').select('*')
    .eq('status', 'dropped').eq('opted_out', false)
    .lte('last_msg_at', cutoff7d).gte('last_msg_at', cutoff8d)
    .lte('nudge_count', 1);

  for (const l of dropped || []) {
    const market = l.market || 'GLOBAL';
    const body = market === 'IN'
      ? `Ek question — Maddy ke saath fitness journey dobara try karni hai? 7 din mein 5000+ logon ne shuru kiya. Reply kare "YES" ya /STOP band karne ke liye.`
      : `Quick question — want to try Maddy's program? 5000+ joined in the last week. Reply YES or /STOP to opt out.`;
    const r = await sendText({
      to: l.phone, body,
      campaignName: campaign('nudge_trial'),
      userName: l.name || 'there',
      templateParams: [body],
    });
    if (r.sent) {
      await sb.from('leads').update({ nudge_count: (l.nudge_count || 0) + 1 }).eq('id', l.id);
      stats.re_engaged++;
    }
  }

  return ok(res, stats);
};
