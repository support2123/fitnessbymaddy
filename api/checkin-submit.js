const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { jsonResponse, errorResponse, handleOptions } = require('../lib/utils');

module.exports = async function handler(req) {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const data = await req.json();
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = data;

    if (!client_id || !week_no) return errorResponse('Missing client_id or week_no');

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return errorResponse('Client not found', 404);
    if (client.status !== 'active') return errorResponse('Client not active');

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Client check-in flagged', {
        phone: client.phone,
        details: `Week ${week_no}: ${issues.slice(0, 200)}`
      });
    }

    const { data: checkin } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return jsonResponse({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin submit error:', err.message);
    return errorResponse('Internal error', 500);
  }
};
