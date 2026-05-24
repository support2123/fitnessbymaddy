const { supabase } = require('../lib/supabase');
const { sendWhatsApp, canSendMessage } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  // Verify cron secret (Vercel sends this header)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow in dev
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .lt('program_ends_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());

    if (error) throw error;

    let sent = 0;
    let skipped = 0;

    for (const client of clients || []) {
      // Calculate current week number
      const startDate = new Date(client.program_started_at);
      const weekNo = Math.ceil((Date.now() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));

      // Check if check-in already submitted this week
      const { data: existingCheckin } = await supabase
        .from('checkins')
        .select('id')
        .eq('client_id', client.id)
        .eq('week_no', weekNo)
        .single();

      if (existingCheckin) {
        skipped++;
        continue;
      }

      if (!(await canSendMessage(client.phone))) {
        skipped++;
        continue;
      }

      const checkinUrl = `https://www.fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

      await sendWhatsApp(client.phone, 'weekly_checkin', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', String(weekNo), checkinUrl]
      });

      sent++;
    }

    return res.status(200).json({ success: true, sent, skipped, total: (clients || []).length });
  } catch (err) {
    console.error('Weekly checkin cron error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
