const { supabase } = require('../lib/supabase');
const { checkEscalation } = require('../lib/escalation');
const { notifyMaddy } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/market');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
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
      .limit(1)
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const escalation = checkEscalation(issues);
    if (escalation.escalate) {
      await notifyMaddy(
        `Client check-in escalation: ${escalation.reason}`,
        `Client: ${maskPhone(client.phone)}, Week ${week_no}, Issues: ${(issues || '').slice(0, 200)}`
      );
    }

    const { data: checkin, error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    }).select().single();

    if (error) {
      console.error(`Checkin error for client ${client_id}:`, error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    const { count: missedCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id);

    const expectedWeeks = parseInt(week_no);
    const actualCheckins = missedCount || 0;
    if (expectedWeeks - actualCheckins >= 2) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        `Client: ${maskPhone(client.phone)}, Expected: ${expectedWeeks}, Submitted: ${actualCheckins}`
      );
    }

    console.log(`Checkin saved: client ${client_id}, week ${week_no}`);
    return res.status(200).json({ status: 'saved', checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
