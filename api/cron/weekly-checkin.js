const { getSupabase } = require('../../lib/supabase');
const { sendTemplate, maskPhone, detectMarket, isHinglish } = require('../../lib/whatsapp');
const { escalateToMaddy } = require('../../lib/escalation');
const { jsonResponse, errorResponse } = require('../../lib/utils');

module.exports = async function handler(req) {
  // Verify cron secret (Vercel sends this header)
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse('Unauthorized', 401);
  }

  const db = getSupabase();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active');

  if (error || !clients) {
    return errorResponse('Failed to fetch clients', 500);
  }

  const results = { sent: 0, skipped: 0, escalated: 0 };

  for (const client of clients) {
    // Calculate current week number
    const startDate = new Date(client.program_started_at);
    const now = new Date();
    const weekNo = Math.ceil((now - startDate) / (7 * 24 * 60 * 60 * 1000));

    // Check if program has ended
    if (client.program_ends_at && now > new Date(client.program_ends_at)) {
      results.skipped++;
      continue;
    }

    // Check for 2 consecutive missed check-ins → escalate
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (weekNo > 2) {
      const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
      if (!submittedWeeks.includes(weekNo - 1) && !submittedWeeks.includes(weekNo - 2)) {
        await escalateToMaddy('2 consecutive missed check-ins', {
          phone: maskPhone(client.phone),
          client_id: client.id,
          missed_weeks: [weekNo - 1, weekNo - 2]
        });
        results.escalated++;
      }
    }

    // Send check-in form link
    const checkinUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);
    const templateName = hinglish ? 'weekly_checkin_hi' : 'weekly_checkin';

    await sendTemplate(client.phone, templateName, {
      isClient: true,
      name: client.name || 'there',
      templateParams: [String(weekNo), checkinUrl]
    });

    results.sent++;
  }

  return jsonResponse({ success: true, ...results });
};
