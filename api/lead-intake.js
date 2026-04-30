const { getSupabase } = require('../lib/supabase');
const { sendText, notifyMaddy } = require('../lib/whatsapp');
const { maskPhone, corsHeaders, jsonResponse, errorResponse } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  const headers = corsHeaders(origin);
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return errorResponse(res, 'Method not allowed', 405);

  try {
    const {
      lead_id, name, phone, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience, medical_conditions,
      photos
    } = req.body;

    if (!phone && !lead_id) {
      return errorResponse(res, 'Phone number or lead ID required');
    }

    const db = getSupabase();

    const escalationFlags = [injuries, medical_conditions].filter(Boolean).join(' ').toLowerCase();
    const needsEscalation = /\b(pregnant|pregnancy|heart|surgery|disc|hernia|medication|diabetes|thyroid)\b/.test(escalationFlags);

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    }

    if (lead) {
      await db.from('leads').update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead.id);
    } else if (phone) {
      const { data: existing } = await db.from('leads').select('*').eq('phone', phone).single();
      if (existing) {
        lead = existing;
        await db.from('leads').update({
          name: name || existing.name,
          last_msg_at: new Date().toISOString()
        }).eq('id', existing.id);
      }
    }

    const intakeData = {
      name, phone, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, photos,
      submitted_at: new Date().toISOString(),
      lead_id: lead?.id || null
    };

    // Store intake as a JSON field or separate table - for now, log it
    // The intake data gets used when program is generated
    if (lead) {
      await db.from('leads').update({
        program_interest: goal || lead.program_interest
      }).eq('id', lead.id);
    }

    if (needsEscalation) {
      await notifyMaddy(
        'Medical flag on intake form',
        `Name: ${name}\nPhone: ${maskPhone(phone)}\nInjuries: ${injuries || 'None'}\nMedical: ${medical_conditions || 'None'}`
      );
    }

    if (phone) {
      await sendText(phone,
        `✅ Thanks ${name || 'there'}! Your intake form is received. Maddy's team will review and start building your plan soon.`
      );
    }

    return jsonResponse(res, { status: 'ok', escalation: needsEscalation });
  } catch (err) {
    console.error('Intake error:', err.message);
    return errorResponse(res, 'Internal error', 500);
  }
};
