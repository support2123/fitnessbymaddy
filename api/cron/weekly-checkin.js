const { getSupabase } = require('../_lib/supabase');
const { sendTemplate } = require('../_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Vercel cron secret if configured
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();
  const summary = { processed: 0, sent: 0, skipped: 0, completed: 0, errors: [] };

  try {
    // Fetch all active clients
    const { data: clients, error: clientsErr } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (clientsErr) {
      throw new Error(`Failed to fetch clients: ${clientsErr.message}`);
    }

    if (!clients || clients.length === 0) {
      return res.status(200).json({ ...summary, message: 'No active clients found' });
    }

    const now = new Date();

    for (const client of clients) {
      summary.processed++;

      try {
        const programStart = new Date(client.program_started_at);
        const programEnd = new Date(client.program_ends_at);

        // Check if program has ended
        if (now > programEnd) {
          await supabase
            .from('clients')
            .update({ status: 'completed' })
            .eq('id', client.id);

          await sendTemplate(client.phone, 'program_completed', [
            client.name || 'there',
          ]);

          // Log the outbound message
          await supabase.from('messages').insert({
            phone: client.phone,
            direction: 'outbound',
            body: null,
            template_name: 'program_completed',
            sent_at: new Date().toISOString(),
            status: 'sent',
          });

          summary.completed++;
          continue;
        }

        // Calculate current week number (1-based)
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weekNo = Math.floor((now - programStart) / msPerWeek) + 1;

        if (weekNo < 1) {
          summary.skipped++;
          continue;
        }

        // Check if a check-in already exists for this week
        const { data: existing, error: checkinErr } = await supabase
          .from('checkins')
          .select('id')
          .eq('client_id', client.id)
          .eq('week_no', weekNo)
          .limit(1);

        if (checkinErr) {
          throw new Error(`Checkin lookup failed: ${checkinErr.message}`);
        }

        if (existing && existing.length > 0) {
          summary.skipped++;
          continue;
        }

        // Generate unique check-in form URL
        const formUrl = `https://fitnessbymaddy.com/checkin.html?c=${client.id}&w=${weekNo}`;

        // Send WhatsApp template with the form link
        await sendTemplate(client.phone, 'weekly_checkin', [
          client.name || 'there',
          String(weekNo),
          formUrl,
        ]);

        // Log the outbound message
        await supabase.from('messages').insert({
          phone: client.phone,
          direction: 'outbound',
          body: formUrl,
          template_name: 'weekly_checkin',
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        summary.sent++;
      } catch (err) {
        summary.errors.push({ client_id: client.id, error: err.message });
      }
    }

    return res.status(200).json(summary);
  } catch (err) {
    return res.status(500).json({ error: err.message, summary });
  }
};
