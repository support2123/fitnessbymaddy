const { getSupabase } = require('./_lib/supabase');
const { checkEscalation } = require('./_lib/escalation');
const { notifyMaddy } = require('./_lib/whatsapp');
const { maskPhone } = require('./_lib/phone');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const clientId = req.query.c || req.body.client_id;
    const weekNo = parseInt(req.query.w || req.body.week_no, 10);

    if (!clientId || isNaN(weekNo)) {
      return res.status(400).json({ error: 'client_id (c) and week_no (w) required' });
    }

    const supabase = getSupabase();

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    const { weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

    const esc = checkEscalation(issues);
    if (esc.escalate) {
      await notifyMaddy(
        'Checkin: health concern flagged',
        `Client: ${maskPhone(client.phone)}\nWeek: ${weekNo}\nTriggers: ${esc.triggers.join(', ')}\nIssues: ${(issues || '').slice(0, 300)}`
      );
    }

    const { data: existing } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', clientId)
      .eq('week_no', weekNo)
      .single();

    const checkinData = {
      client_id: clientId,
      week_no: weekNo,
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score, 10) : null,
      energy: energy ? parseInt(energy, 10) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    };

    if (existing) {
      await supabase.from('checkins').update(checkinData).eq('id', existing.id);
    } else {
      await supabase.from('checkins').insert(checkinData);
    }

    if (client.program === '12wk') {
      try {
        const generateUrl = `https://${req.headers.host}/api/generate-program`;
        fetch(generateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 })
        }).catch(err => console.error('Program generation trigger failed:', err.message));
      } catch (e) {
        console.error('Failed to trigger program generation:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Check-in submitted! Your updated program will be sent shortly.'
    });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
