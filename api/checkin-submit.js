const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const contentType = req.headers['content-type'] || '';
    let clientId, weekNo, weight, waist, complianceScore, energy, issues, photoUrls;

    if (contentType.includes('multipart/form-data')) {
      clientId = req.body.client_id;
      weekNo = parseInt(req.body.week_no, 10);
      weight = parseFloat(req.body.weight) || null;
      waist = parseFloat(req.body.waist) || null;
      complianceScore = parseInt(req.body.compliance_score, 10) || null;
      energy = parseInt(req.body.energy, 10) || null;
      issues = req.body.issues || null;
      photoUrls = [];

      if (req.body.photo_urls) {
        photoUrls = JSON.parse(req.body.photo_urls);
      }
    } else {
      ({
        client_id: clientId,
        week_no: weekNo,
        weight,
        waist,
        compliance_score: complianceScore,
        energy,
        issues,
        photo_urls: photoUrls,
      } = req.body);
      weekNo = parseInt(weekNo, 10);
    }

    if (!clientId || !weekNo) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (issues && needsEscalation(issues)) {
      await escalateToMaddy('Concerning check-in response', {
        client_id: clientId,
        week_no: weekNo,
        issues: issues.slice(0, 300),
      });
    }

    const { data: checkin, error } = await db
      .from('checkins')
      .insert({
        client_id: clientId,
        week_no: weekNo,
        form_submitted_at: new Date().toISOString(),
        weight: weight || null,
        waist: waist || null,
        compliance_score: complianceScore || null,
        energy: energy || null,
        issues: issues || null,
        photos_urls: photoUrls || [],
      })
      .select()
      .single();

    if (error) {
      console.error('Check-in insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: clientId,
            week_no: weekNo + 1,
          }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      checkin_id: checkin.id,
      message: 'Check-in submitted successfully',
    });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
