const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, sendText, maskPhone } = require('../../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    // Also allow Vercel cron (no auth header but from Vercel)
    if (!process.env.VERCEL) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const db = getSupabase();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Get all active clients
    const { data: clients, error } = await db.from('clients')
      .select('*')
      .eq('status', 'active');

    if (error || !clients) {
      return res.status(500).json({ error: 'Failed to fetch clients' });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const started = new Date(client.program_started_at);
        const now = new Date();
        const diffDays = Math.floor((now - started) / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(diffDays / 7) + 1;

        // Check if program has ended
        if (client.program_ends_at && now > new Date(client.program_ends_at)) {
          results.skipped++;
          continue;
        }

        // Check if already submitted this week
        const { data: existing } = await db.from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) {
          results.skipped++;
          continue;
        }

        // Check for 2 consecutive missed check-ins → escalate
        const { data: recentCheckins } = await db.from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
        if (weekNo - lastCheckinWeek >= 3) {
          await sendText('+917082478374',
            `⚠️ 2+ missed check-ins: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nLast check-in: Week ${lastCheckinWeek}`
          );
        }

        // Send check-in form link
        const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = client.phone?.startsWith('+91') ? 'IN' : 'GLOBAL';

        const msg = market === 'IN'
          ? `Hey ${client.name || 'Champion'}! 📋 Week ${weekNo} check-in time!\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos aur apna feel share karo. Hum aapka next week ka plan iske basis pe banayenge 💪`
          : `Hey ${client.name || 'Champion'}! 📋 Time for your Week ${weekNo} check-in!\n\nUpdate your progress here:\n${checkinUrl}\n\nShare your weight, waist, photos and how you're feeling. We'll build your next week's plan based on this 💪`;

        await sendText(client.phone, msg);

        await db.from('messages').insert({
          phone: client.phone,
          direction: 'out',
          body: msg,
          template_name: 'weekly_checkin',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        results.sent++;
      } catch (e) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, e.message);
        results.errors++;
      }
    }

    console.log(`Weekly check-in cron: ${JSON.stringify(results)}`);
    return res.status(200).json({ success: true, results });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
