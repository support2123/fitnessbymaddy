const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, headers);
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
    } = body;

    if (!client_id || !week_no) {
      res.writeHead(400, headers);
      return res.end(JSON.stringify({ error: 'client_id and week_no required' }));
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('id, phone, program')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      res.writeHead(404, headers);
      return res.end(JSON.stringify({ error: 'Active client not found' }));
    }

    if (needsEscalation(issues)) {
      await escalateToMaddy({
        reason: 'Health concern in weekly check-in',
        phone: client.phone,
        details: issues,
      });
    }

    const photoUrls = [];
    if (photos_urls && Array.isArray(photos_urls)) {
      for (const url of photos_urls) {
        photoUrls.push(url);
      }
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photoUrls,
        form_submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      res.writeHead(500, headers);
      return res.end(JSON.stringify({ error: 'Failed to save check-in' }));
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host || 'fitnessbymaddy.com'}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    res.writeHead(200, headers);
    return res.end(JSON.stringify({ ok: true, id: checkin.id }));
  } catch (err) {
    console.error('Check-in error:', err.message);
    res.writeHead(500, headers);
    return res.end(JSON.stringify({ error: 'Internal server error' }));
  }
};
