const { getClient } = require('../../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var db = getClient();
    var now = new Date();

    // --- 1. Nudge unreplied new leads (2hrs+ old, < 24hrs) ---
    var twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    var oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    var unrepliedResult = await db.from('leads').select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo);
    var unreplied = unrepliedResult.data || [];

    var nudged = 0;
    for (var i = 0; i < unreplied.length; i++) {
      var lead = unreplied[i];
      var createdAt = new Date(lead.created_at);
      var hoursSince = (now - createdAt) / (1000 * 60 * 60);

      if (hoursSince >= 24) {
        await db.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        continue;
      }

      await sendTemplate(lead.phone, 'nudge_trial', [lead.name || 'there']);
      nudged++;
    }

    // --- 2. Re-engage dropped leads at exactly 7 days ---
    var sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    var droppedResult = await db.from('leads').select('*')
      .eq('status', 'dropped')
      .lt('last_msg_at', sevenDaysAgo)
      .gte('last_msg_at', eightDaysAgo);
    var dropped = droppedResult.data || [];

    var reengaged = 0;
    for (var j = 0; j < dropped.length; j++) {
      await sendTemplate(dropped[j].phone, 'reengage_v1', [dropped[j].name || 'there']);
      reengaged++;
    }

    // --- 3. Nudge clients with pending check-ins (+24h, +48h) ---
    var activeResult = await db.from('clients').select('*').eq('status', 'active');
    var activeClients = activeResult.data || [];

    var checkinNudges = 0;
    for (var k = 0; k < activeClients.length; k++) {
      var client = activeClients[k];
      var startDate = new Date(client.program_started_at);
      var weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));
      if (weekNo < 1) continue;

      var checkinResult = await db.from('checkins').select('id')
        .eq('client_id', client.id).eq('week_no', weekNo).single();

      if (!checkinResult.data) {
        var dayOfWeek = now.getDay();
        // Monday (1) = +24h, Tuesday (2) = +48h after Sunday send
        if (dayOfWeek === 1 || dayOfWeek === 2) {
          var checkinUrl = 'https://fitnessbymaddy.com/checkin?c=' + client.id + '&w=' + weekNo;
          await sendTemplate(client.phone, 'checkin_reminder', [
            client.name || 'there',
            checkinUrl
          ], true);
          checkinNudges++;
        }

        // 2 consecutive missed → escalate to Maddy
        if (weekNo > 1) {
          var prevResult = await db.from('checkins').select('id')
            .eq('client_id', client.id).eq('week_no', weekNo - 1).single();
          if (!prevResult.data) {
            await notifyMaddy('2 Missed Check-ins',
              'Client: ' + client.name + ' (' + client.program + ')\nMissed weeks '
              + (weekNo - 1) + ' and ' + weekNo + '. Manual follow-up needed.');
          }
        }
      }
    }

    return res.status(200).json({
      ok: true, nudged: nudged, reengaged: reengaged, checkinNudges: checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
