const { supabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/helpers');

module.exports = async function handler(req, res) {
  // Vercel crons send Authorization: Bearer <CRON_SECRET>
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    // Fetch all active clients with their program start date
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('id, name, phone, program, program_started_at')
      .eq('status', 'active');

    if (clientsErr) {
      console.error('[weekly-checkin] Failed to fetch clients:', clientsErr.message);
      return res.status(500).json({ error: 'db_error', detail: clientsErr.message });
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ sent: 0, skipped: 0, message: 'no active clients' });
    }

    const now = new Date();
    let sent = 0;
    let skipped = 0;
    const errors = [];

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const msSinceStart = now.getTime() - startDate.getTime();
        const daysSinceStart = Math.floor(msSinceStart / (1000 * 60 * 60 * 24));
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        if (weekNo < 1) {
          skipped++;
          continue;
        }

        // Check if client already submitted a check-in for this week
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Build check-in link
        const link = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

        // Choose template based on market
        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);

        const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin_en';
        const body = hinglish
          ? `Hey ${client.name}! 💪 Week ${weekNo} ka check-in time hai. Apna progress share karo — weight, waist, photos. Ye form fill karo: ${link}`
          : `Hey ${client.name}! 💪 Time for your Week ${weekNo} check-in. Share your progress — weight, waist, photos. Fill out this form: ${link}`;

        const result = await sendWhatsApp({
          phone: client.phone,
          templateName,
          params: [client.name, String(weekNo), link],
          body,
        });

        if (result.ok) {
          sent++;

          // Schedule nudge reminders at +24hrs and +48hrs
          const nudge24 = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
          const nudge48 = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();

          const nudgeBody24 = hinglish
            ? `Hi ${client.name}, abhi tak check-in nahi hua Week ${weekNo} ka. 2 min lagenge — yahan se karo: ${link}`
            : `Hi ${client.name}, you haven't checked in for Week ${weekNo} yet. It only takes 2 minutes: ${link}`;

          const nudgeBody48 = hinglish
            ? `${client.name}, Week ${weekNo} check-in miss ho raha hai! Coach ke liye ye data zaroori hai. Abhi fill karo: ${link}`
            : `${client.name}, your Week ${weekNo} check-in is still missing! Your coach needs this data. Fill it now: ${link}`;

          await supabase.from('messages').insert([
            {
              phone: client.phone,
              direction: 'out',
              body: nudgeBody24,
              template_name: hinglish ? 'checkin_nudge_hi' : 'checkin_nudge_en',
              status: 'scheduled',
              sent_at: nudge24,
            },
            {
              phone: client.phone,
              direction: 'out',
              body: nudgeBody48,
              template_name: hinglish ? 'checkin_nudge_hi' : 'checkin_nudge_en',
              status: 'scheduled',
              sent_at: nudge48,
            },
          ]);
        } else {
          errors.push({ client_id: client.id, phone: maskPhone(client.phone), error: result.error });
        }
      } catch (err) {
        console.error(`[weekly-checkin] Error for client ${client.id}:`, err.message);
        errors.push({ client_id: client.id, error: err.message });
      }
    }

    console.log(`[weekly-checkin] Done: sent=${sent}, skipped=${skipped}, errors=${errors.length}`);
    return res.status(200).json({ sent, skipped, errors: errors.length, errorDetails: errors });
  } catch (err) {
    console.error('[weekly-checkin] Fatal error:', err.message);
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
};
