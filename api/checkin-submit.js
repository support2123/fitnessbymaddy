const { supabase } = require('./lib/supabase');
const { shouldEscalate, createEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      await supabase
        .from('checkins')
        .update({
          weight, waist, compliance_score, energy, issues,
          photos_urls: photos_urls || [],
          form_submitted_at: new Date().toISOString()
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id, week_no, weight, waist,
        compliance_score, energy, issues,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      });
    }

    if (issues) {
      const escalationReason = shouldEscalate(issues);
      if (escalationReason) {
        await createEscalation({
          clientId: client_id,
          phone: client.phone,
          reason: `Check-in issue: ${escalationReason}`,
          triggerMessage: issues
        });
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
