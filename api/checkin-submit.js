const { supabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');
const { needsEscalation, getEscalationReason } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'active client not found' });

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'check-in already submitted for this week' });
    }

    const { data: checkin, error } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no),
        weight: parseFloat(weight) || null,
        waist: parseFloat(waist) || null,
        compliance_score: parseInt(compliance_score) || null,
        energy: parseInt(energy) || null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    if (issues && needsEscalation(issues)) {
      await notifyMaddy(
        'Client check-in concern',
        `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssue: ${issues}\nTrigger: ${getEscalationReason(issues)}`
      );
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL || 'www.fitnessbymaddy.com';
      fetch(`https://${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    return res.json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'submission failed' });
  }
};
