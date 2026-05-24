const { supabase } = require('./_lib/supabase');
const { sendWhatsApp, sendEscalation } = require('./_lib/whatsapp');
const { maskPhone, needsEscalation, isHinglish } = require('./_lib/helpers');

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

    // Verify client
    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!inner(market)')
      .eq('id', client_id)
      .eq('status', 'active')
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Active client not found' });
    }

    // Check for escalation in issues
    if (needsEscalation(issues)) {
      await sendEscalation(
        `Client ${maskPhone(client.phone)} (Week ${week_no}) reported: "${(issues || '').slice(0, 100)}". Needs review.`
      );
    }

    // Check for 2 consecutive missed check-ins
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('week_no')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const lastSubmitted = recentCheckins?.[0]?.week_no || 0;
    if (week_no - lastSubmitted > 2) {
      await sendEscalation(
        `Client ${maskPhone(client.phone)} missed 2+ check-ins. Last submitted: Week ${lastSubmitted}, now submitting Week ${week_no}.`
      );
    }

    // Save check-in
    const { error: checkinErr } = await supabase.from('checkins').upsert({
      client_id,
      week_no: parseInt(week_no),
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: compliance_score ? parseInt(compliance_score) : null,
      energy: energy ? parseInt(energy) : null,
      issues: issues || null,
      photos_urls: photos_urls || []
    }, { onConflict: 'client_id,week_no' });

    if (checkinErr) {
      console.error('Check-in save error:', checkinErr.message);
      return res.status(500).json({ error: 'Failed to save check-in' });
    }

    // Confirmation message
    const market = client.leads?.market || 'GLOBAL';
    const confirmMsg = isHinglish(market)
      ? `Week ${week_no} check-in received ✅ Thank you! Aapka updated program jald aayega.`
      : `Week ${week_no} check-in received ✅ Thank you! Your updated program will be sent shortly.`;

    await sendWhatsApp({ phone: client.phone, body: confirmMsg, templateName: 'checkin_confirmed' });

    // Trigger program generation for 12-week clients
    if (client.program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id, week_no: parseInt(week_no) + 1 })
        });
      } catch (e) {
        console.error('Program generation trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Check-in error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
