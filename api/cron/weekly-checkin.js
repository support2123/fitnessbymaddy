const { supabase } = require('../../lib/supabase');
const { sendTemplate, sendText } = require('../../lib/whatsapp');
const { getLanguage } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header for cron jobs)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(market)')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || !clients.length) {
      return res.status(200).json({ ok: true, processed: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.floor(daysDiff / 7) + 1;

      // Check if program has ended
      if (client.program_ends_at && now > new Date(client.program_ends_at)) {
        await supabase.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const lastCheckinWeek = recentCheckins && recentCheckins.length > 0
        ? recentCheckins[0].week_no : 0;

      if (weekNo - lastCheckinWeek >= 3) {
        await escalateToMaddy('2+ consecutive missed check-ins', {
          name: client.name,
          phone: client.phone,
          details: `Last check-in: Week ${lastCheckinWeek}, Current: Week ${weekNo}`
        });
        escalated++;
      }

      // Send check-in form link
      const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
      const market = client.leads ? client.leads.market : 'GLOBAL';
      const lang = getLanguage(market);

      let msg;
      if (lang === 'hinglish') {
        msg = `Hey ${client.name}! Week ${weekNo} check-in time 💪\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, measurements aur photos daal do — next week ka plan iske basis pe banega!`;
      } else {
        msg = `Hey ${client.name}! Time for your Week ${weekNo} check-in 💪\n\nUpdate your progress here:\n${checkinUrl}\n\nAdd your weight, measurements, and photos — your next week's plan will be based on this!`;
      }

      await sendTemplate(client.phone, 'weekly_checkin', {
        name: client.name,
        isClient: true,
        templateParams: [client.name, String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({ ok: true, sent, escalated, total: clients.length });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
