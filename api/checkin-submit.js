const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const complianceNum = parseInt(compliance_score, 10);
    const energyNum = parseInt(energy, 10);

    if (complianceNum < 1 || complianceNum > 10 || energyNum < 1 || energyNum > 10) {
      return res.status(400).json({ error: 'Scores must be between 1 and 10' });
    }

    const { data: checkin, error: insertError } = await supabase
      .from('checkins')
      .insert({
        client_id,
        week_no: parseInt(week_no, 10),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: complianceNum,
        energy: energyNum,
        issues: issues || null,
        photos_urls: photos_urls || []
      })
      .select()
      .single();

    if (insertError) {
      console.error('Checkin insert error:', insertError.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    const hasEscalation = issues && /\b(pain|dizziness|dizzy|faint|not eating|purge|vomit)\b/i.test(issues);
    if (hasEscalation) {
      const { notifyMaddy, maskPhone } = require('./lib/whatsapp');
      await notifyMaddy(
        'Check-in health concern',
        `Client ${maskPhone(client.phone)} week ${week_no}: ${issues.slice(0, 150)}`
      );
    }

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
