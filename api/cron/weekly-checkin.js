const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { escalateMissedCheckins } = require('../../lib/escalation');
const { detectMarket } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { data: activeClients } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (!activeClients || activeClients.length === 0) {
      return res.status(200).json({ ok: true, message: 'No active clients' });
    }

    const results = [];

    for (const client of activeClients) {
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

      if (weekNo < 1) continue;

      // Check if check-in already submitted this week
      const { data: existing } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .maybeSingle();

      if (existing) {
        results.push({ client_id: client.id, status: 'already_submitted' });
        continue;
      }

      // Check for consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
      const missedCount = weekNo - lastCheckinWeek - 1;

      if (missedCount >= 2) {
        await escalateMissedCheckins(client.name, client.phone, missedCount);
      }

      // Send check-in form link
      const checkinUrl = `https://www.fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
      const market = detectMarket(client.phone);

      let msg;
      if (market === 'IN') {
        msg = `Hey ${client.name || ''}! Week ${weekNo} check-in time.\n\nApna progress update karo: ${checkinUrl}\n\nWeight, waist, compliance aur photos share karo. Ye tumhare next week ka plan decide karega!`;
      } else {
        msg = `Hey ${client.name || ''}! Time for your Week ${weekNo} check-in.\n\nSubmit your update here: ${checkinUrl}\n\nShare your weight, waist, compliance and photos. This determines your next week's plan!`;
      }

      await sendText(client.phone, msg, true);

      results.push({ client_id: client.id, week_no: weekNo, status: 'sent' });
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
