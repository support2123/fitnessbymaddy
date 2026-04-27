const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp } = require('../../lib/whatsapp');
const { detectMarket, isHinglish, maskPhone } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

const SITE_BASE = 'https://www.fitnessbymaddy.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  try {
    const db = getSupabase();
    const results = { sent: 0, skipped: 0, errors: 0 };

    // Get all active clients
    const { data: clients } = await db
      .from('clients')
      .select('id, phone, name, program, program_started_at')
      .eq('status', 'active');

    if (!clients || clients.length === 0) {
      return res.json({ message: 'no active clients', ...results });
    }

    for (const client of clients) {
      try {
        // Calculate current week number
        const started = new Date(client.program_started_at);
        const now = new Date();
        const daysSinceStart = Math.floor((now - started) / 86400000);
        const weekNo = Math.floor(daysSinceStart / 7) + 1;

        // Check if already submitted this week
        const { data: existing } = await db
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (existing && existing.length > 0) {
          results.skipped++;
          continue;
        }

        // Check for 2 consecutive missed checkins
        if (weekNo >= 3) {
          const { data: prev } = await db
            .from('checkins')
            .select('week_no')
            .eq('client_id', client.id)
            .in('week_no', [weekNo - 1, weekNo - 2]);

          if (!prev || prev.length === 0) {
            await escalateToMaddy(
              '2_missed_checkins',
              client.phone,
              `${client.name || 'Client'} missed weeks ${weekNo - 2} and ${weekNo - 1}`
            );
          }
        }

        const market = detectMarket(client.phone);
        const hinglish = isHinglish(market);
        const formUrl = `${SITE_BASE}/checkin?c=${client.id}&w=${weekNo}`;

        const msg = hinglish
          ? `Happy Sunday! ☀️ Week ${weekNo} ka check-in time hai!\n\nYe form fill karo (2 min lagega): ${formUrl}\n\nWeight, waist, photos — sab daal do. Progress track karna zaroori hai! 💪`
          : `Happy Sunday! ☀️ Time for your Week ${weekNo} check-in!\n\nFill out this form (takes 2 min): ${formUrl}\n\nWeight, waist, photos — track everything. Consistency = results! 💪`;

        await sendWhatsApp({ phone: client.phone, body: msg, templateName: 'weekly_checkin' });
        results.sent++;

      } catch (clientErr) {
        console.error(`Checkin send failed for ${maskPhone(client.phone)}:`, clientErr.message);
        results.errors++;
      }
    }

    console.log(`Weekly checkin cron: sent=${results.sent}, skipped=${results.skipped}, errors=${results.errors}`);
    return res.json({ success: true, ...results });

  } catch (err) {
    console.error('weekly-checkin cron error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
