const { getSupabase } = require('./lib/supabase');
const { needsEscalation, maskPhone } = require('./lib/utils');
const { sendAndLog } = require('./lib/whatsapp');

const MADDY_PHONE = '917082478374';

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;
    const leadId = body.lead_id;
    const {
      name, age, gender, height, weight,
      goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level,
    } = body;

    if (!leadId) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', leadId);

    const intakeData = {
      age, gender, height, weight, goal,
      injuries, diet_pref, schedule,
      medical_conditions, experience_level,
      submitted_at: new Date().toISOString(),
    };

    const escalationText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(escalationText)) {
      await sendAndLog(
        MADDY_PHONE,
        'escalation_alert',
        [maskPhone(lead.phone), `Intake flag: ${escalationText.slice(0, 200)}`],
        true
      );
    }

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form',
      sent_at: new Date().toISOString(),
      status: 'received',
    });

    return res.status(200).json({ success: true, lead_id: leadId });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
