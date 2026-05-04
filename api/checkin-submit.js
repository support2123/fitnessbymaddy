const { supabase } = require('../lib/supabase');
const { needsEscalation, notifyMaddy } = require('../lib/escalation');
const { sendTemplate } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues } = req.body;

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

    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Concern in weekly check-in',
        client.phone,
        `Week ${week_no}: ${(issues || '').slice(0, 200)}`
      );
    }

    // Check consecutive missed check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    const submittedWeeks = (recentCheckins || []).map(c => c.week_no);
    const weekNum = parseInt(week_no);
    if (weekNum > 2 && !submittedWeeks.includes(weekNum - 1) && !submittedWeeks.includes(weekNum - 2)) {
      await notifyMaddy(
        '2 consecutive missed check-ins',
        client.phone,
        `${client.name || 'Client'} missed weeks ${weekNum - 2} and ${weekNum - 1}`
      );
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', weekNum)
      .single();

    const checkinData = {
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      form_submitted_at: new Date().toISOString()
    };

    if (existing) {
      await supabase.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert({
        client_id, week_no: weekNum, ...checkinData
      });
    }

    if (client.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';
      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id, week_no: weekNum + 1 })
      }).catch(err => console.error('Program gen trigger failed:', err.message));
    }

    await sendTemplate(client.phone, 'checkin_received', [
      client.name || 'there',
      String(week_no)
    ]);

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });

  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
