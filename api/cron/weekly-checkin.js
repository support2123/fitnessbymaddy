const {
  supabaseFetch,
  insertMessage,
  maskPhone,
  detectMarket,
  corsHeaders,
  handleCors,
} = require('../_lib/supabase');

/**
 * Vercel Cron: Runs every Sunday at 9:00 AM IST (3:30 UTC)
 * Sends weekly check-in form links to all active clients
 */
export const config = {
  cron: '30 3 * * 0',
};

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Fetch all active clients
    const clients = await supabaseFetch('/clients?status=eq.active&select=*&order=created_at.asc');

    if (!clients || clients.length === 0) {
      console.log('No active clients found for weekly check-in');
      return res.status(200).json({ success: true, sent: 0 });
    }

    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

    const results = [];
    let sentCount = 0;

    for (const client of clients) {
      try {
        // Calculate current week number from start_date
        let weekNo = client.current_week || 1;
        if (client.start_date) {
          const startDate = new Date(client.start_date);
          const now = new Date();
          const diffMs = now - startDate;
          weekNo = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
        }

        // Skip if past program duration
        if (weekNo > (client.total_weeks || 12)) {
          continue;
        }

        const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
        const market = detectMarket(client.phone);
        const templateName = market === 'IN' ? 'weekly_checkin' : 'weekly_checkin_en';

        const sendRes = await fetch(`${baseUrl}/api/send-whatsapp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: client.phone,
            template_name: templateName,
            template_params: [client.name || 'there', String(weekNo), formUrl],
          }),
        });

        const status = sendRes.ok ? 'sent' : 'failed';
        results.push({ client_id: client.id, week: weekNo, status });

        if (sendRes.ok) {
          sentCount++;

          // Update current week in client record
          await supabaseFetch(`/clients?id=eq.${encodeURIComponent(client.id)}`, {
            method: 'PATCH',
            body: {
              current_week: weekNo,
              last_checkin_sent: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          });
        }

        // Log message
        await insertMessage(
          client.phone,
          'out',
          `[Check-in form sent: week ${weekNo}]`,
          templateName
        );

        console.log(`Check-in ${status}: ${maskPhone(client.phone)}, week ${weekNo}`);
      } catch (clientErr) {
        console.error(`Failed to send check-in to ${maskPhone(client.phone)}:`, clientErr.message);
        results.push({ client_id: client.id, status: 'error', error: clientErr.message });
      }
    }

    console.log(`Weekly check-in cron complete: ${sentCount}/${clients.length} sent`);

    return res.status(200).json({
      success: true,
      total_clients: clients.length,
      sent: sentCount,
      results,
    });
  } catch (error) {
    console.error('weekly-checkin cron error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
