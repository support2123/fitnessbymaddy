const { supabase } = require('../lib/supabase');
const { escalateToMaddy } = require('../lib/escalation');
const { needsEscalation, maskPhone, jsonResponse, handleCors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'Method not allowed' }, 405);

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1)
      .single();

    if (existing) {
      return jsonResponse(res, { error: 'Check-in already submitted for this week' }, 409);
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return jsonResponse(res, { error: 'Failed to save check-in' }, 500);
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Client reported concerning issue in check-in', {
        clientPhone: client.phone,
        name: client.name,
        details: `Week ${week_no}: "${issues.substring(0, 200)}"`
      });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    return jsonResponse(res, { success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return jsonResponse(res, { error: 'Internal error' }, 500);
  }
};
