const { supabase } = require('../lib/supabase');
const { notifyMaddy } = require('../lib/whatsapp');
const { needsEscalation, sanitizeInput, maskPhone } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no, weight, waist, compliance_score, energy, issues, photos_urls } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients').select('*').eq('id', client_id).eq('status', 'active').maybeSingle();

    if (!client) return res.status(404).json({ error: 'Client not found or inactive' });

    const checkinData = {
      client_id,
      week_no: parseInt(week_no),
      weight: parseFloat(weight) || null,
      waist: parseFloat(waist) || null,
      compliance_score: Math.min(10, Math.max(1, parseInt(compliance_score) || 5)),
      energy: Math.min(10, Math.max(1, parseInt(energy) || 5)),
      issues: sanitizeInput(issues),
      photos_urls: Array.isArray(photos_urls) ? photos_urls.slice(0, 5) : [],
    };

    const { data: checkin, error } = await supabase
      .from('checkins').insert(checkinData).select().single();

    if (error) {
      console.error('Checkin insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    if (needsEscalation(issues)) {
      await notifyMaddy(
        'Client health concern',
        `${maskPhone(client.phone)} (Week ${week_no}): "${sanitizeInput(issues).slice(0, 200)}"`
      );
    }

    const { count: missedCount } = await supabase
      .from('checkins')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .is('weight', null)
      .order('week_no', { ascending: false })
      .limit(2);

    if (missedCount >= 2) {
      await notifyMaddy(
        '2 missed check-ins',
        `Client ${maskPhone(client.phone)} has ${missedCount} incomplete check-ins`
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
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 }),
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    return res.json({ success: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
