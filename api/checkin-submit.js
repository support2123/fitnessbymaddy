const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { json, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

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
      return json(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return json(res, { error: 'Active client not found' }, 404);
    }

    if (issues) {
      const escalationReason = needsEscalation(issues);
      if (escalationReason) {
        await createEscalation('checkin', client.id, client.phone, escalationReason);
      }
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .upsert(
        {
          client_id,
          week_no: parseInt(week_no, 10),
          weight: weight ? parseFloat(weight) : null,
          waist: waist ? parseFloat(waist) : null,
          compliance_score: compliance_score
            ? parseInt(compliance_score, 10)
            : null,
          energy: energy ? parseInt(energy, 10) : null,
          issues: issues || null,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString(),
        },
        { onConflict: 'client_id,week_no' }
      )
      .select()
      .single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return json(res, { error: 'Failed to save check-in' }, 500);
    }

    if (client.program === '12wk') {
      const siteUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.SITE_URL || 'https://fitnessbymaddy.com';

      fetch(`${siteUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      }).catch((err) =>
        console.error('Program generation trigger failed:', err.message)
      );
    }

    return json(res, { action: 'checkin_saved', checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
