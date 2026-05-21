const { getSupabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');
const { checkEscalation } = require('./lib/escalation');
const { notifyMaddy } = require('./lib/notify-maddy');
const { maskPhone } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
    } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no are required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    if (client.status !== 'active') {
      return res.status(400).json({ error: 'Client is not active' });
    }

    const { data: existingCheckin } = await db
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existingCheckin) {
      await db.from('checkins').update({
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || [],
        form_submitted_at: new Date().toISOString()
      }).eq('id', existingCheckin.id);
    } else {
      await db.from('checkins').insert({
        client_id,
        week_no: parseInt(week_no),
        weight: weight || null,
        waist: waist || null,
        compliance_score: compliance_score ? parseInt(compliance_score) : null,
        energy: energy ? parseInt(energy) : null,
        issues: issues || null,
        photos_urls: photos_urls || []
      });
    }

    if (issues) {
      const esc = checkEscalation(issues);
      if (esc.escalate) {
        await notifyMaddy(
          `Check-in concern from ${client.name || maskPhone(client.phone)}`,
          `Week ${week_no}\nIssues: ${issues}\nTriggers: ${esc.reasons.join(', ')}`
        );
      }
    }

    if (energy && parseInt(energy) <= 3) {
      await notifyMaddy(
        `Low energy alert: ${client.name || maskPhone(client.phone)}`,
        `Week ${week_no}, Energy: ${energy}/10, Compliance: ${compliance_score}/10`
      );
    }

    await sendTemplate(client.phone, 'checkin_thanks', {
      name: client.name || 'there',
      templateParams: [client.name || 'there', String(week_no)]
    });

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
      } catch (err) {
        console.error('Program generation trigger failed:', err.message);
      }
    }

    const { data: missedCheckins } = await db
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(3);

    if (missedCheckins) {
      const weekNumbers = missedCheckins.map(c => c.week_no);
      const currentWeek = parseInt(week_no);
      let consecutiveMissed = 0;
      for (let w = currentWeek - 1; w >= 1; w--) {
        if (!weekNumbers.includes(w)) consecutiveMissed++;
        else break;
      }
      if (consecutiveMissed >= 2) {
        await notifyMaddy(
          `2+ missed check-ins: ${client.name || maskPhone(client.phone)}`,
          `Client missed ${consecutiveMissed} consecutive check-ins before week ${week_no}`
        );
      }
    }

    return res.status(200).json({ ok: true, message: 'Check-in saved' });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
