const { supabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { ESCALATION_KEYWORDS, maskPhone } = require('../lib/constants');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls,
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('id, phone, program, name')
      .eq('id', client_id)
      .maybeSingle();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
    });

    if (error) {
      console.error('[Checkin] Insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (issues && ESCALATION_KEYWORDS.some(kw => issues.toLowerCase().includes(kw))) {
      await notifyMaddy(`Checkin flagged for ${client.name || maskPhone(client.phone)} (week ${week_no}): "${issues.slice(0, 200)}"`);
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (e) {
        console.error('[Checkin] Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted successfully' });
  } catch (err) {
    console.error('[Checkin Error]', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
