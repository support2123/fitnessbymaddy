const { getSupabase } = require('./lib/supabase');
const { needsEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/whatsapp');
const { maskPhone } = require('./lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabase();

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

    if (!client || client.status !== 'active') {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: checkin, error: insertErr } = await supabase
      .from('checkins')
      .upsert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight ? parseFloat(weight) : null,
        waist: waist ? parseFloat(waist) : null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }, { onConflict: 'client_id,week_no' })
      .select()
      .single();

    if (insertErr) {
      console.error('Checkin insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues) {
      const esc = needsEscalation(issues);
      if (esc.escalate) {
        await notifyMaddy(
          `Client health concern: "${esc.trigger}"`,
          `Client: ${client.name || maskPhone(client.phone)}\nWeek: ${week_no}\nIssue: ${issues}`
        );
      }
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
