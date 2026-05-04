const { supabase } = require('../lib/supabase');
const { sendText } = require('../lib/whatsapp');
const { maskPhone, cors } = require('../lib/helpers');

const MADDY_PHONE = process.env.MADDY_PHONE || '+917082478374';

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const escalationKeywords = ['pain', 'dizz', 'disordered', 'binge', 'faint', 'vomit'];
    const needsEscalation = issues && escalationKeywords.some(k => issues.toLowerCase().includes(k));

    let photoUrls = [];
    if (photos_urls && Array.isArray(photos_urls)) {
      for (const url of photos_urls) {
        photoUrls.push(url);
      }
    }

    const { error } = await supabase.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      form_submitted_at: new Date().toISOString(),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null
    });

    if (error) throw error;

    if (needsEscalation) {
      await sendText(MADDY_PHONE,
        `HEALTH FLAG - ${client.name || maskPhone(client.phone)}\n` +
        `Week ${week_no} check-in mentions: ${issues.slice(0, 200)}\n` +
        `Please review immediately.`
      );
    }

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in submitted' });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
