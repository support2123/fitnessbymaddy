const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone } = require('../lib/mask-phone');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    // Update lead with intake data
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .update({
        name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id)
      .select()
      .single();

    if (leadErr) {
      console.error(`Intake update failed for ${maskPhone(phone)}:`, leadErr.message);
      return res.status(400).json({ error: 'Lead not found' });
    }

    // Store extended intake data as a client record (pre-conversion)
    // This gets linked properly when Exly webhook fires
    const { error: clientErr } = await supabase
      .from('clients')
      .upsert({
        lead_id,
        phone,
        name,
        email,
        status: 'active'
      }, {
        onConflict: 'lead_id',
        ignoreDuplicates: true
      });

    if (clientErr) {
      console.log(`Client pre-insert note for ${maskPhone(phone)}:`, clientErr.message);
    }

    // Check for medical escalation triggers
    const escalationTerms = ['injury', 'pregnant', 'surgery', 'medication', 'pain', 'heart'];
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ').toLowerCase();
    const needsReview = escalationTerms.some(term => allText.includes(term));

    if (needsReview) {
      const { escalateToMaddy } = require('../lib/escalation');
      await escalateToMaddy(
        'Medical flag in intake form',
        phone,
        `Name: ${name}, Issues: ${injuries || medical_conditions || 'N/A'}`
      );
    }

    // Send confirmation
    await sendTemplate(phone, 'intake_received', [
      name.split(' ')[0]
    ]);

    return res.status(200).json({ ok: true, lead_id });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
