const { getSupabase } = require('../_lib/supabase');
const { sendWhatsApp } = require('../_lib/whatsapp');
const { isHinglish, detectMarket } = require('../_lib/market');
const { escalateToMaddy } = require('../_lib/escalation');

module.exports = async function handler(req, res) {
  // Verify Vercel Cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  try {
    // Get all active clients
    const { data: clients, error } = await db
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let escalated = 0;

    for (const client of clients) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const now = new Date();
      const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
      const weekNo = Math.ceil(daysSinceStart / 7);

      if (weekNo < 1) continue;

      // Check if program has ended
      if (client.program_ends_at && new Date(client.program_ends_at) < now) {
        await db.from('clients').update({ status: 'completed' }).eq('id', client.id);
        continue;
      }

      // Check if check-in already submitted this week
      const { data: existing } = await db
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .limit(1);

      if (existing && existing.length > 0) continue;

      // Check for 2 consecutive missed check-ins
      if (weekNo >= 3) {
        const { data: recentCheckins } = await db
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .gte('week_no', weekNo - 2)
          .order('week_no', { ascending: false });

        const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
        if (!submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
          await escalateToMaddy({
            reason: '2 consecutive missed check-ins',
            phone: client.phone,
            clientName: client.name,
            message: `${client.name} missed weeks ${weekNo - 2} and ${weekNo - 1}. Program: ${client.program}`
          });
          escalated++;
        }
      }

      // Send check-in form link
      const market = detectMarket(client.phone);
      const hinglish = isHinglish(market);
      const formUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      const msg = hinglish
        ? `Hey ${client.name || 'champ'}! Week ${weekNo} check-in time.\n\nApna progress update karo — weight, waist, photos, aur kaise feel kar rahe ho.\n\n${formUrl}`
        : `Hey ${client.name || 'champ'}! It's Week ${weekNo} check-in time.\n\nUpdate your progress — weight, waist, photos, and how you're feeling.\n\n${formUrl}`;

      await sendWhatsApp({
        phone: client.phone,
        templateName: 'weekly_checkin',
        body: msg,
        params: [client.name || 'there', String(weekNo), formUrl]
      });

      sent++;
    }

    return res.status(200).json({
      message: 'Weekly check-in cron complete',
      sent,
      escalated,
      total: clients.length
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Cron failed' });
  }
};
