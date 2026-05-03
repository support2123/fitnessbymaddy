const { getSupabase } = require('./_lib/supabase');
const { needsEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    // Verify client exists and is active
    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) return res.status(404).json({ error: 'Active client not found' });

    // Escalation check on issues
    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Check-in — Medical Flag',
        `Client: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nIssues: ${(issues || '').slice(0, 300)}`
      );
    }

    // Insert check-in
    const { data: checkin, error } = await db.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no, 10),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }).select().single();

    if (error) throw error;

    // Check for 2 consecutive missed check-ins (current week minus previous)
    const { data: recentCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(5);

    const weekNums = (recentCheckins || []).map(c => c.week_no).sort((a, b) => b - a);
    const currentWeek = parseInt(week_no, 10);
    if (currentWeek >= 3) {
      const hasPrev = weekNums.includes(currentWeek - 1);
      const hasPrev2 = weekNums.includes(currentWeek - 2);
      if (!hasPrev && !hasPrev2) {
        await notifyMaddy(
          '2 Missed Check-ins',
          `Client: ${client.name || maskPhone(client.phone)}\nLast submitted: Week ${weekNums[1] || 'unknown'}\nCurrent: Week ${currentWeek}`
        );
      }
    }

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no, 10) + 1 })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin?.id });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
