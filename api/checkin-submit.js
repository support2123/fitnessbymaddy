const { getSupabase } = require('./_lib/supabase');
const { sendText, notifyMaddy } = require('./_lib/whatsapp');
const { checkEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const sb = getSupabase();

    const { data: client } = await sb
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existing } = await sb
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Check-in already submitted for this week' });
    }

    const esc = checkEscalation(issues);
    if (esc.escalate) {
      await notifyMaddy(
        `⚠️ CLIENT CHECK-IN ESCALATION\nClient: ${client.name || client.phone}\nWeek: ${week_no}\nReason: "${esc.reason}"\nIssues: ${(issues || '').slice(0, 200)}`
      );
    }

    let photoUrls = photos_urls || [];
    if (typeof photoUrls === 'string') {
      photoUrls = JSON.parse(photoUrls);
    }

    const { data: checkin } = await sb.from('checkins').insert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photoUrls
    }).select().single();

    await sendText(client.phone,
      `✅ Week ${week_no} check-in received! We'll review your progress and update your plan shortly.`
    );

    if (client.program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://www.fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id,
            week_no: parseInt(week_no) + 1
          })
        });
      } catch (genErr) {
        console.error('Program generation trigger failed:', genErr.message);
      }
    }

    const { count: missedCount } = await sb
      .from('checkins')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client_id)
      .is('weight', null);

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('Checkin error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
