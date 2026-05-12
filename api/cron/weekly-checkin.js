const { getSupabase } = require('../../lib/supabase');
const { sendWhatsApp, notifyMaddy } = require('../../lib/whatsapp');
const { isHinglish, detectMarket, maskPhone } = require('../../lib/market');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret (Vercel sends this header for cron jobs)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && authHeader !== `Bearer ${process.env.INTERNAL_API_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const db = getSupabase();

  // Get all active clients
  const { data: clients, error } = await db
    .from('clients')
    .select('*')
    .eq('status', 'active')
    .lte('program_started_at', new Date().toISOString());

  if (error || !clients) {
    console.error('Failed to fetch clients:', error?.message);
    return res.status(500).json({ error: 'Failed to fetch clients' });
  }

  let sent = 0;
  let skipped = 0;
  const escalations = [];

  for (const client of clients) {
    // Calculate current week number
    const started = new Date(client.program_started_at);
    const now = new Date();
    const daysSinceStart = Math.floor((now - started) / (1000 * 60 * 60 * 24));
    const weekNo = Math.floor(daysSinceStart / 7) + 1;

    // Check if program has ended
    if (client.program_ends_at && now > new Date(client.program_ends_at)) {
      skipped++;
      continue;
    }

    // Check if check-in already exists for this week
    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client.id)
      .eq('week_no', weekNo)
      .single();

    if (existingCheckin) {
      skipped++;
      continue;
    }

    // Check for 2 consecutive missed check-ins
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client.id)
      .order('week_no', { ascending: false })
      .limit(1);

    const lastCheckinWeek = recentCheckins?.[0]?.week_no || 0;
    if (weekNo - lastCheckinWeek >= 3) {
      escalations.push(client);
    }

    // Send check-in form link
    const checkinUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;
    const market = detectMarket(client.phone);
    const hinglish = isHinglish(market);

    const body = hinglish
      ? `Hey ${client.name || ''}! 📋 Week ${weekNo} check-in time!\n\nApna progress update karo:\n${checkinUrl}\n\nWeight, waist, photos daal do — taaki next week ka plan perfect bane!`
      : `Hey ${client.name || ''}! 📋 Time for your Week ${weekNo} check-in!\n\nSubmit your progress here:\n${checkinUrl}\n\nInclude weight, waist, and progress photos for the best plan update!`;

    await sendWhatsApp({
      phone: client.phone,
      body,
      templateName: 'weekly_checkin',
      isClient: true
    });

    sent++;
  }

  // Send escalation notifications
  for (const client of escalations) {
    await notifyMaddy(
      '2+ Missed Check-ins',
      `Client: ${client.name || maskPhone(client.phone)}\nProgram: ${client.program}\nNeeds follow-up.`
    );
  }

  return res.status(200).json({
    success: true,
    sent,
    skipped,
    escalations: escalations.length,
    total_clients: clients.length
  });
};
