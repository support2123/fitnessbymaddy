const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

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
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Health concern in check-in', {
        phone: client.phone,
        text: issues,
      });
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score ? parseInt(compliance_score) : null,
          energy: energy ? parseInt(energy) : null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (error) throw error;

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no),
    ]);

    if (client.program === '12wk') {
      try {
        await fetch(
          `${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : ''}/api/generate-program`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
          }
        );
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
