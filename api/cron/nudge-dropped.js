const { getSupabase } = require('../_lib/supabase');
const { sendTemplate, checkRateLimit } = require('../_lib/whatsapp');
const { maskPhone } = require('../_lib/mask');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  var auth = req.headers.authorization;
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    var supabase = getSupabase();

    var sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    var { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .gte('created_at', fourteenDaysAgo)
      .lte('created_at', sevenDaysAgo);

    if (error || !leads) {
      return res.status(500).json({ error: 'Failed to fetch leads' });
    }

    var nudged = 0;
    var skipped = 0;

    for (var i = 0; i < leads.length; i++) {
      var lead = leads[i];

      var rateLimited = await checkRateLimit(lead.phone);
      if (rateLimited) {
        skipped++;
        continue;
      }

      try {
        await sendTemplate(lead.phone, 'nudge_trial', [
          lead.name || 'there'
        ]);
        nudged++;
      } catch (err) {
        console.error('Nudge failed for:', maskPhone(lead.phone));
      }
    }

    var twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    var { data: pendingCheckins } = await supabase
      .from('clients')
      .select('id, phone, name, program_started_at')
      .eq('status', 'active');

    var checkinNudges = 0;

    if (pendingCheckins) {
      for (var j = 0; j < pendingCheckins.length; j++) {
        var client = pendingCheckins[j];
        var startDate = new Date(client.program_started_at);
        var now = new Date();
        var daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        var weekNo = Math.floor(daysSinceStart / 7) + 1;

        var dayOfWeek = now.getDay();
        if (dayOfWeek !== 1 && dayOfWeek !== 2) continue;

        var existing = await supabase.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing.data) continue;

        var checkinUrl = 'https://fitnessbymaddy.com/checkin?c=' + client.id + '&w=' + weekNo;
        try {
          await sendTemplate(client.phone, 'checkin_nudge', [
            client.name || 'there',
            String(weekNo),
            checkinUrl
          ]);
          checkinNudges++;
        } catch (err) {
          console.error('Checkin nudge failed for client:', client.id);
        }
      }
    }

    var { data: missedClients } = await supabase.rpc('get_consecutive_missed_checkins');

    if (missedClients && missedClients.length > 0) {
      var whatsapp = require('../_lib/whatsapp');
      var { notifyMaddy } = require('../_lib/escalation');

      for (var k = 0; k < missedClients.length; k++) {
        await notifyMaddy(supabase, whatsapp, {
          type: '2_missed_checkins',
          summary: (missedClients[k].name || 'Client') + ' missed 2 consecutive check-ins',
          phone_masked: maskPhone(missedClients[k].phone)
        });
      }
    }

    return res.status(200).json({
      status: 'ok',
      leads_nudged: nudged,
      leads_skipped: skipped,
      checkin_nudges: checkinNudges
    });
  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
