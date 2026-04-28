const { supabase } = require('../../lib/supabase');
const { sendWhatsApp, detectMarket } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalate');
const { maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternal = authHeader === `Bearer ${process.env.INTERNAL_API_KEY}`;
  if (!isVercelCron && !isInternal && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();

    // NUDGE 1: New leads with no reply after 2 hours
    const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const { data: staleNewLeads } = await supabase
      .from('leads')
      .select('*')
      .eq('status', 'new')
      .lt('created_at', twoHoursAgo)
      .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString());

    let nudged = 0;
    if (staleNewLeads) {
      for (const lead of staleNewLeads) {
        const market = detectMarket(lead.phone);
        await sendWhatsApp(lead.phone, market === 'IN' ? 'nudge_trial_hi' : 'nudge_trial_en', [
          lead.name || 'there',
          'https://www.fitnessbymaddy.com/intake?lead=' + lead.id
        ]);
        nudged++;
      }
    }

    // NUDGE 2: Drop leads with no reply after 24 hours
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { data: deadLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('status', 'new')
      .lt('created_at', oneDayAgo);

    let dropped = 0;
    if (deadLeads) {
      for (const lead of deadLeads) {
        await supabase.from('leads').update({ status: 'dropped' }).eq('id', lead.id);
        dropped++;
      }
    }

    // NUDGE 3: Check-in reminders for clients (+24h, +48h)
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    let checkinNudges = 0;
    if (activeClients) {
      for (const client of activeClients) {
        const weekNo = calculateWeekNo(client.program_started_at);
        if (weekNo < 1) continue;

        const { data: checkin } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (!checkin) {
          const market = detectMarket(client.phone);
          await sendWhatsApp(client.phone, market === 'IN' ? 'checkin_nudge_hi' : 'checkin_nudge_en', [
            client.name || 'there',
            `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`
          ]);
          checkinNudges++;
        }

        // Escalate if 2 consecutive weeks missed
        if (weekNo >= 2) {
          const { data: recent } = await supabase
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .gte('week_no', weekNo - 1)
            .order('week_no', { ascending: false });

          if (!recent || recent.length === 0) {
            await escalateToMaddy(
              '2 consecutive missed check-ins',
              `Client: ${maskPhone(client.phone)}, Weeks ${weekNo - 1} and ${weekNo}`
            );
          }
        }
      }
    }

    return res.json({ ok: true, nudged, dropped, checkin_nudges: checkinNudges });

  } catch (err) {
    console.error('Nudge cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(startDate) {
  if (!startDate) return 0;
  const start = new Date(startDate);
  const now = new Date();
  return Math.ceil((now - start) / (1000 * 60 * 60 * 24 * 7));
}
