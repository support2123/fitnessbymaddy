const { getSupabase } = require('./lib/supabase');
const { notifyMaddy, maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await db.from('clients').select('*').eq('id', client_id).single();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (client.status !== 'active') return res.status(400).json({ error: 'Client not active' });

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { data: checkin, error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (insertErr) throw insertErr;

    if (issues) {
      const lowerIssues = issues.toLowerCase();
      const dangerTerms = ['pain', 'dizzy', 'faint', 'chest', 'can\'t breathe', 'nausea'];
      if (dangerTerms.some(t => lowerIssues.includes(t))) {
        await notifyMaddy(
          'Client reported health concern in check-in',
          `Client: ${client.name} (${maskPhone(client.phone)})\nWeek: ${week_no}\nIssue: ${issues}`
        );
      }
    }

    const { data: missedCount } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id);
    const expectedWeeks = parseInt(week_no);
    const actualCheckins = missedCount ? missedCount.length : 0;
    if (expectedWeeks - actualCheckins >= 2) {
      await notifyMaddy(
        '2+ consecutive missed check-ins',
        `Client: ${client.name} (${maskPhone(client.phone)})\nExpected ${expectedWeeks} check-ins, have ${actualCheckins}`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = req.headers['x-forwarded-proto'] + '://' + req.headers['x-forwarded-host'];
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.SUPABASE_SERVICE_KEY
          },
          body: JSON.stringify({ clientId: client_id, weekNo: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program gen trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, checkinId: checkin.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
