const { getSupabase } = require('./_lib/supabase');
const { checkEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos_urls,
      token
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('id, phone, name, program, status')
      .eq('id', client_id)
      .eq('status', 'active')
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    const { data: existing } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const escalation = checkEscalation(issues);

    const { error: insertErr } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    });

    if (insertErr) {
      console.error('Check-in insert error:', insertErr);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (escalation.escalate) {
      await notifyMaddy(
        `Client check-in flag (${escalation.reason})`,
        `Client: ${client.name}\nPhone: ${maskPhone(client.phone)}\nWeek: ${week_no}\nIssues: ${issues}`
      );
    }

    const { count: missedCount } = await db
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id);

    const expectedWeeks = parseInt(week_no);
    const actualCheckins = (missedCount || 0);
    if (expectedWeeks - actualCheckins >= 2) {
      await notifyMaddy(
        '2+ consecutive missed check-ins',
        `Client: ${client.name}\nPhone: ${maskPhone(client.phone)}\nExpected weeks: ${expectedWeeks}, Submitted: ${actualCheckins}`
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });

  } catch (err) {
    console.error('Check-in error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
