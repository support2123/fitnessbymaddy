const { supabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: checkin, error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' }).select().single();

    if (error) {
      console.error('Checkin save error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    const msg = client.name
      ? `Thanks ${client.name}! Week ${week_no} check-in received ✅ Your updated program will be sent soon.`
      : `Week ${week_no} check-in received ✅ Your updated program will be sent soon.`;
    await sendText(client.phone, msg, true);

    if (client.program === '12wk') {
      const origin = `https://${req.headers.host}`;
      fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(() => {});
    }

    const { data: missedCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    if (missedCheckins) {
      const weekNums = missedCheckins.map(c => c.week_no).sort((a, b) => b - a);
      if (weekNums.length >= 2) {
        const gaps = [];
        for (let i = 0; i < weekNums.length - 1; i++) {
          if (weekNums[i] - weekNums[i + 1] > 1) gaps.push(weekNums[i] - 1);
        }
        if (gaps.length >= 2) {
          await notifyMaddy(
            '2 consecutive missed check-ins',
            `Client: ${client.name || client.phone}\nProgram: ${client.program}\nMissed weeks detected around: ${gaps.join(', ')}`
          );
        }
      }
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
