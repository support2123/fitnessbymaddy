const { getSupabase } = require('./_lib/supabase');
const { sendText } = require('./_lib/whatsapp');
const { handleCors, maskPhone, isHinglish, needsEscalation } = require('./_lib/utils');
const { checkAndEscalate } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'client not found' });

    if (issues) {
      const escalationKw = needsEscalation(issues);
      if (escalationKw) {
        await checkAndEscalate(client.phone, issues, escalationKw);
      }
    }

    const { data: checkin, error } = await db.from('checkins').upsert({
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
      console.error('[Checkin] DB error:', error.message);
      return res.status(500).json({ error: 'db_error' });
    }

    const market = client.phone ? (client.phone.startsWith('91') ? 'IN' : 'GLOBAL') : 'GLOBAL';
    const hinglish = isHinglish(market);

    if (hinglish) {
      await sendText(client.phone,
        `Check-in received for Week ${week_no}! Bahut accha 💪\n` +
        `Tumhara updated program jaldi aa raha hai.`
      );
    } else {
      await sendText(client.phone,
        `Week ${week_no} check-in received! Great job staying consistent.\n` +
        `Your updated program will be sent shortly.`
      );
    }

    if (client.program === '12wk') {
      const generateUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/generate-program`
        : `${process.env.SITE_URL || 'https://www.fitnessbymaddy.com'}/api/generate-program`;

      fetch(generateUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY || ''}`
        },
        body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
      }).catch(err => {
        console.error('[Checkin] Failed to trigger program gen:', err.message);
      });
    }

    return res.status(200).json({ ok: true, checkin_id: checkin.id });
  } catch (err) {
    console.error('[Checkin] Error:', err.message);
    return res.status(500).json({ error: 'internal' });
  }
};
