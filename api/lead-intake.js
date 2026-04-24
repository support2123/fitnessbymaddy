const { getSupabase } = require('../lib/supabase');
const { corsHeaders } = require('../lib/utils');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      equipment_access,
      schedule,
      wake_time,
      sleep_time,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone is required' });
    }

    const db = getSupabase();
    let lead;

    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      const { data: newLead } = await db
        .from('leads')
        .insert({
          phone: phone || '',
          name,
          source: 'intake_form',
          status: 'qualified',
          market: 'GLOBAL',
        })
        .select()
        .single();
      lead = newLead;
    }

    await db
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    const intakeData = {
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      training_experience,
      equipment_access,
      schedule,
      wake_time,
      sleep_time,
      email,
    };

    const { error: storageErr } = await db.storage
      .from('client-data')
      .upload(
        `intakes/${lead.id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) {
      console.error('Storage upload error:', storageErr.message);
    }

    const { needsEscalation } = require('../lib/utils');
    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      const { sendWhatsApp } = require('../lib/whatsapp');
      const { maskPhone } = require('../lib/utils');
      await sendWhatsApp('+917082478374', 'escalation_alert', [
        maskPhone(lead.phone),
        'intake_medical_flag',
        allText.slice(0, 100),
      ]);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      lead_id: lead.id,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
