const { supabase } = require('../_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('../_lib/whatsapp');
const { isHinglish } = require('../_lib/helpers');

module.exports = async function handler(req, res) {
  // Verify cron authorization
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow if called from Vercel Cron (has x-vercel-cron header) or if no secret set
    if (!req.headers['x-vercel-cron'] && process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Get all active clients
    const { data: clients } = await supabase
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('status', 'active')
      .lte('program_started_at', new Date().toISOString());

    if (!clients || clients.length === 0) {
      return res.status(200).json({ message: 'No active clients', sent: 0 });
    }

    let sent = 0;
    let errors = 0;

    for (const client of clients) {
      try {
        // Calculate current week number
        const startDate = new Date(client.program_started_at);
        const now = new Date();
        const daysDiff = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
        const weekNo = Math.ceil(daysDiff / 7);

        if (weekNo < 1) continue;

        // Check if already submitted this week
        const { data: existing } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .single();

        if (existing) continue;

        // Check for 2 consecutive missed check-ins
        const { data: recentCheckins } = await supabase
          .from('checkins')
          .select('week_no')
          .eq('client_id', client.id)
          .order('week_no', { ascending: false })
          .limit(1);

        const lastWeek = recentCheckins?.[0]?.week_no || 0;
        if (weekNo - lastWeek >= 3) {
          await sendEscalation(
            `Client ${client.name || client.phone} has missed 2+ consecutive check-ins (last: Week ${lastWeek}, current: Week ${weekNo}).`
          );
        }

        const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
        const market = client.leads?.market || 'GLOBAL';

        const msg = isHinglish(market)
          ? `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in time.\n\nYeh form fill karo (5 min):\n${formUrl}\n\nPhotos aur honest answers dena — isse program better banta hai! 💪`
          : `Hey ${client.name || ''}! 📋 Time for your Week ${weekNo} check-in.\n\nFill this form (5 min):\n${formUrl}\n\nInclude photos and honest answers — it helps us optimize your program! 💪`;

        const result = await sendWhatsApp({ phone: client.phone, body: msg, templateName: 'weekly_checkin' });
        if (result.success) sent++;
      } catch (clientErr) {
        errors++;
        console.error(`Check-in send failed for client ${client.id}:`, clientErr.message);
      }
    }

    return res.status(200).json({
      message: `Weekly check-ins sent`,
      total: clients.length,
      sent,
      errors
    });
  } catch (err) {
    console.error('Weekly check-in cron error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
