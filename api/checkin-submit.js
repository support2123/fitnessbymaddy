const { getSupabase } = require('../lib/supabase');
const { sendJson, sendError, corsHeaders } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendError(res, 405, 'POST only');

  const {
    client_id, week_no, weight, waist,
    compliance_score, energy, issues, photos_urls
  } = req.body || {};

  if (!client_id || !week_no) {
    return sendError(res, 400, 'Missing client_id or week_no');
  }

  const db = getSupabase();

  const { data: client } = await db
    .from('clients')
    .select('*')
    .eq('id', client_id)
    .eq('status', 'active')
    .single();

  if (!client) return sendError(res, 404, 'Active client not found');

  const { data: existing } = await db
    .from('checkins')
    .select('id')
    .eq('client_id', client_id)
    .eq('week_no', week_no)
    .single();

  if (existing) {
    await db.from('checkins').update({
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight || null,
      waist: waist || null,
      compliance_score: compliance_score || null,
      energy: energy || null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });
  }

  if (issues) {
    const lowerIssues = issues.toLowerCase();
    const dangerKeywords = ['pain', 'dizz', 'injur', 'bleed', 'faint', 'vomit', 'chest'];
    const hasDanger = dangerKeywords.some(kw => lowerIssues.includes(kw));
    if (hasDanger) {
      await escalateToMaddy(client.phone, 'pain', `Week ${week_no} check-in: ${issues}`);
    }
  }

  if (client.program === '12wk') {
    try {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      await fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 }),
      });
    } catch (err) {
      console.error('Failed to trigger program generation:', err.message);
    }
  }

  return sendJson(res, 200, { success: true, client_id, week_no });
};
