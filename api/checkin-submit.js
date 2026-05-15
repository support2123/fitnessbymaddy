const { supabase } = require('./_lib/supabase');
const { notifyMaddy } = require('./_lib/whatsapp');
const { checkEscalation } = require('./_lib/escalation');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (error) {
      console.error('Check-in insert error:', error);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues) {
      const escalation = checkEscalation(issues);
      if (escalation.shouldEscalate) {
        await notifyMaddy(
          'Client check-in flagged',
          `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nKeywords: ${escalation.keywords.join(', ')}\nIssues: ${issues.substring(0, 300)}`
        );
      }
    }

    const { data: prevCheckins } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .is('form_submitted_at', null);

    const missedCount = prevCheckins ? prevCheckins.length : 0;
    if (missedCount >= 2) {
      await notifyMaddy(
        '2+ missed check-ins before this one',
        `Client: ${client.name || maskPhone(client.phone)}\nMissed ${missedCount} check-ins before submitting week ${week_no}`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: client.id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
