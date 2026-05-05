const {
  supabaseFetch,
  insertMessage,
  maskPhone,
  detectMarket,
  corsHeaders,
  handleCors,
} = require('../_lib/supabase');

/**
 * Vercel Cron: Runs daily at 10:00 AM IST (4:30 UTC)
 * - Re-engages dropped leads from exactly 7 days ago (who didn't STOP)
 * - Nudges clients who haven't submitted check-in (24hrs and 48hrs after send)
 */
export const config = {
  cron: '30 4 * * *',
};

export default async function handler(req, res) {
  if (handleCors(req, res)) return;

  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

  const results = { reengaged: 0, nudged_24h: 0, nudged_48h: 0, errors: [] };

  try {
    // === PART 1: Re-engage dropped leads from exactly 7 days ago ===
    // Only those who did NOT explicitly say STOP (dropped_reason is null or not 'unsubscribed')
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysAgoDate = sevenDaysAgo.toISOString().split('T')[0];

    const droppedLeads = await supabaseFetch(
      `/leads?status=eq.dropped&dropped_reason=neq.unsubscribed&updated_at=gte.${sevenDaysAgoDate}T00:00:00&updated_at=lt.${sevenDaysAgoDate}T23:59:59&reengaged_at=is.null&select=*`
    );

    if (droppedLeads && droppedLeads.length > 0) {
      for (const lead of droppedLeads) {
        try {
          const market = detectMarket(lead.phone);
          const templateParams = [lead.name || 'there'];

          await fetch(`${baseUrl}/api/send-whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: lead.phone,
              template_name: 'reengage_dropped',
              template_params: templateParams,
            }),
          });

          // Mark as re-engaged so we don't message again
          await supabaseFetch(`/leads?id=eq.${encodeURIComponent(lead.id)}`, {
            method: 'PATCH',
            body: { reengaged_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          });

          await insertMessage(lead.phone, 'out', '[Re-engagement offer sent]', 'reengage_dropped');

          results.reengaged++;
          console.log(`Re-engaged: ${maskPhone(lead.phone)}`);
        } catch (err) {
          console.error(`Re-engage failed for ${maskPhone(lead.phone)}:`, err.message);
          results.errors.push({ phone: maskPhone(lead.phone), action: 'reengage', error: err.message });
        }
      }
    }

    // === PART 2: Nudge clients who haven't submitted check-in ===
    const activeClients = await supabaseFetch('/clients?status=eq.active&select=*');

    if (activeClients && activeClients.length > 0) {
      for (const client of activeClients) {
        try {
          const weekNo = client.current_week || 1;

          // Check if they've submitted this week's check-in
          const checkins = await supabaseFetch(
            `/checkins?client_id=eq.${encodeURIComponent(client.id)}&week_no=eq.${weekNo}&select=id&limit=1`
          );

          if (checkins && checkins.length > 0) {
            // Already submitted, skip
            continue;
          }

          // Check when the check-in reminder was last sent
          if (!client.last_checkin_sent) {
            continue;
          }

          const lastSent = new Date(client.last_checkin_sent);
          const now = new Date();
          const hoursSinceSent = (now - lastSent) / (1000 * 60 * 60);

          // Send nudge at ~24hrs or ~48hrs (with a 2hr window)
          let nudgeType = null;
          if (hoursSinceSent >= 24 && hoursSinceSent < 26) {
            nudgeType = '24h';
          } else if (hoursSinceSent >= 48 && hoursSinceSent < 50) {
            nudgeType = '48h';
          }

          if (!nudgeType) {
            continue;
          }

          const formUrl = `https://fitnessbymaddy.com/checkin?c=${client.id}&w=${weekNo}`;
          const market = detectMarket(client.phone);

          let message;
          if (nudgeType === '24h') {
            message = market === 'IN'
              ? `Hey ${client.name || 'there'}! Aapka weekly check-in abhi pending hai. Bas 2 minute lagenge:\n${formUrl}`
              : `Hey ${client.name || 'there'}! Your weekly check-in is still pending. It only takes 2 minutes:\n${formUrl}`;
          } else {
            message = market === 'IN'
              ? `${client.name || 'there'}, check-in submit karna mat bhoolo! Yeh aapki progress ke liye important hai:\n${formUrl}`
              : `${client.name || 'there'}, don't forget to submit your check-in! It's important for your progress:\n${formUrl}`;
          }

          await fetch(`${baseUrl}/api/send-whatsapp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: client.phone,
              message,
            }),
          });

          await insertMessage(client.phone, 'out', `[Check-in nudge ${nudgeType}]`, 'checkin_nudge');

          if (nudgeType === '24h') results.nudged_24h++;
          if (nudgeType === '48h') results.nudged_48h++;

          console.log(`Nudge ${nudgeType} sent: ${maskPhone(client.phone)}`);
        } catch (err) {
          console.error(`Nudge failed for ${maskPhone(client.phone)}:`, err.message);
          results.errors.push({ phone: maskPhone(client.phone), action: 'nudge', error: err.message });
        }
      }
    }

    console.log(`Nudge cron complete: reengaged=${results.reengaged}, nudged_24h=${results.nudged_24h}, nudged_48h=${results.nudged_48h}`);

    return res.status(200).json({
      success: true,
      ...results,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error) {
    console.error('nudge-dropped cron error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
