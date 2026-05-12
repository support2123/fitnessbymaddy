const { getSupabase } = require('./_lib/supabase');
const { handleCors } = require('./_lib/cors');

function maskPhone(phone) {
  if (!phone || phone.length < 4) return '***';
  return '***' + phone.slice(-3);
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = req.body || {};

    // Validate required fields
    if (!client_id || week_no === undefined || week_no === null) {
      return res.status(400).json({
        error: 'Missing required fields: client_id, week_no',
      });
    }

    // Verify client exists and get program info
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .single();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Upsert checkin record
    const { error: upsertErr } = await supabase
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no,
          form_submitted_at: new Date().toISOString(),
          weight: weight || null,
          waist: waist || null,
          compliance_score: compliance_score || null,
          energy: energy || null,
          issues: issues || null,
          photos_urls: photos_urls || [],
        },
        { onConflict: 'client_id,week_no' }
      );

    if (upsertErr) {
      console.error(
        `Checkin upsert error for client ${client_id}:`,
        upsertErr.message
      );
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // For 12-week program clients, trigger program generation
    if (client.program === '12wk') {
      try {
        // Trigger program generation asynchronously via internal endpoint
        const baseUrl =
          process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'http://localhost:3000';

        fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: week_no + 1,
          }),
        }).catch((fetchErr) => {
          // Non-blocking — log but don't fail the check-in
          console.error(
            `Program generation trigger failed for client ${client_id}:`,
            fetchErr.message
          );
        });
      } catch (triggerErr) {
        console.error(
          `Program generation trigger error for client ${client_id}:`,
          triggerErr.message
        );
        // Don't fail the check-in response
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Check-in submit error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
