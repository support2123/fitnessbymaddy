const { supabase } = require('../lib/supabase');
const { checkEscalation } = require('../lib/helpers');
const { escalateClient, escalateMissedCheckins } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, next_week_focus
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    // Handle photo uploads if present (URLs from Supabase Storage)
    let photosUrls = [];
    if (req.body.photos_urls) {
      photosUrls = Array.isArray(req.body.photos_urls) ? req.body.photos_urls : [req.body.photos_urls];
    }

    const { data: checkin, error: insertError } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
        energy: energy ? parseInt(energy, 10) : null,
        issues: issues || null,
        photos_urls: photosUrls,
        next_week_focus: next_week_focus || null
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Check for escalation triggers in issues
    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation.shouldEscalate) {
        await escalateClient(
          client.name, client.phone,
          escalation.reason,
          `Week ${week_no} check-in: "${issues}"`
        );
      }
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://www.fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
