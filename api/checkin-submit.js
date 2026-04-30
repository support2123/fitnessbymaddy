const { supabase } = require('./_lib/supabase');
const { needsEscalation, notifyMaddy } = require('./_lib/escalation');
const { sendWhatsApp } = require('./_lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      client_id, week_no, weight, waist,
      compliance_score, energy, issues, photos_urls
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

    if (needsEscalation(issues)) {
      await notifyMaddy('Check-in flagged for review', {
        client_id,
        client_name: client.name,
        week_no,
        issues
      }, sendWhatsApp);
    }

    const { data: prev } = await supabase
      .from('checkins')
      .select('id')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (prev && prev.length === 0 && week_no > 2) {
      await notifyMaddy('2+ consecutive missed check-ins before this submission', {
        client_id,
        client_name: client.name,
        week_no
      }, sendWhatsApp);
    }

    const { error } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || [],
      form_submitted_at: new Date().toISOString()
    }, { onConflict: 'client_id,week_no' });

    if (error) throw error;

    if (client.program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    const thankMsg = client.phone.startsWith('91')
      ? `Week ${week_no} check-in mil gaya! Tera naya plan jaldi aayega.`
      : `Week ${week_no} check-in received! Your updated plan is on the way.`;
    await sendWhatsApp(client.phone, thankMsg);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
