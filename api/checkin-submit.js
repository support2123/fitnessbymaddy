import supabase from '../lib/supabase.js';
import { jsonResponse, corsHeaders } from '../lib/helpers.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

  if (!client_id || !week_no) {
    return jsonResponse(res, { error: 'client_id and week_no required' }, 400);
  }

  try {
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, { error: 'Client not found' }, 404);

    const { data, error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString(),
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) throw error;

    if (needsEscalation(issues)) {
      await escalateToMaddy('Health concern in weekly check-in', {
        phone: client.phone,
        name: client.name,
        message: issues,
      });
    }

    if (client.program === '12wk') {
      try {
        await fetch(`${getBaseUrl(req)}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return jsonResponse(res, { ok: true, checkin_id: data.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return jsonResponse(res, { error: 'Submission failed' }, 500);
  }
}

function getBaseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'fitnessbymaddy.com';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
