const { supabase } = require('../../lib/supabase');
const { sendTemplate } = require('../../lib/whatsapp');
const { isHinglish } = require('../../lib/market');
const { escalateToMaddy } = require('../../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Vercel cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;

    const results = { sent: 0, skipped: 0, escalated: 0 };

    for (const client of clients || []) {
      const weekNo = calculateWeekNo(client.program_started_at);

      if (weekNo < 1) {
        results.skipped++;
        continue;
      }

      // Check for 2 consecutive missed check-ins
      const { data: recentCheckins } = await supabase
        .from('checkins')
        .select('week_no')
        .eq('client_id', client.id)
        .order('week_no', { ascending: false })
        .limit(2);

      const completedWeeks = (recentCheckins || []).map((c) => c.week_no);
      const missedConsecutive =
        weekNo >= 3 &&
        !completedWeeks.includes(weekNo - 1) &&
        !completedWeeks.includes(weekNo - 2);

      if (missedConsecutive) {
        await escalateToMaddy(
          client.phone,
          '2 consecutive missed check-ins',
          `Client ${client.name || client.phone} missed weeks ${weekNo - 2} and ${weekNo - 1}`
        );
        results.escalated++;
      }

      const market = detectMarketFromPhone(client.phone);
      const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;

      const templateName = isHinglish(market) ? 'weekly_checkin_hi' : 'weekly_checkin_en';
      await sendTemplate(
        client.phone,
        templateName,
        [client.name || 'there', String(weekNo), checkinUrl],
        true
      );

      results.sent++;
    }

    return res.status(200).json({
      success: true,
      ...results,
      total: (clients || []).length,
    });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function calculateWeekNo(programStartedAt) {
  if (!programStartedAt) return 0;
  const start = new Date(programStartedAt);
  const now = new Date();
  const diffMs = now - start;
  return Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
}

function detectMarketFromPhone(phone) {
  const cleaned = (phone || '').replace(/[^0-9]/g, '');
  if (cleaned.startsWith('91')) return 'IN';
  if (cleaned.startsWith('971')) return 'UAE';
  if (cleaned.startsWith('44')) return 'UK';
  return 'GLOBAL';
}
