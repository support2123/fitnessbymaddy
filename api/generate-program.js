const { getSupabase } = require('../lib/supabase');
const { generateWeeklyProgram } = require('../lib/program-architect');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf-generator');
const { sendMedia } = require('../lib/whatsapp');
const { escalateToMaddy } = require('../lib/escalation');
const { maskPhone, jsonResponse, programLabel } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return jsonResponse(res, 200, { ok: true });
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return jsonResponse(res, 400, { error: 'client_id and week_no required' });
    }

    const db = getSupabase();

    const { data: client } = await db
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return jsonResponse(res, 404, { error: 'Client not found' });

    const { data: existing } = await db
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', week_no)
      .single();

    if (existing) {
      return jsonResponse(res, 200, { ok: true, message: 'Program already exists for this week', existing: true });
    }

    const { data: lastCheckins } = await db
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const clientProfile = {
      name: client.name,
      program: programLabel(client.program),
      currentWeek: week_no
    };

    const result = await generateWeeklyProgram(clientProfile, lastCheckins || []);

    if (result.flagged) {
      await escalateToMaddy(
        client.phone,
        `Risky program content flagged for Week ${week_no}`,
        result.reason,
        client_id
      );

      await db.from('programs').insert({
        client_id,
        week_no,
        workout_plan: result.raw?.workout_plan || null,
        nutrition_plan: result.raw?.nutrition_plan || null,
        notes: `FLAGGED: ${result.reason}`,
        generated_at: new Date().toISOString()
      });

      return jsonResponse(res, 200, {
        ok: false,
        flagged: true,
        reason: result.reason
      });
    }

    const pdfBuffer = await generateProgramPDF(
      client_id,
      week_no,
      result.workoutPlan,
      result.nutritionPlan,
      result.notes
    );

    const pdfUrl = await uploadPDF(client_id, week_no, pdfBuffer);

    const { error: insertErr } = await db.from('programs').insert({
      client_id,
      week_no,
      workout_plan: result.workoutPlan,
      nutrition_plan: result.nutritionPlan,
      notes: result.notes,
      pdf_url: pdfUrl,
      generated_at: new Date().toISOString()
    });

    if (insertErr) {
      console.error(`[PROGRAM INSERT] ${insertErr.message}`);
      return jsonResponse(res, 500, { error: 'Failed to save program' });
    }

    if (pdfUrl) {
      const caption = `Week ${week_no} program ready! ${result.notes || ''}`.slice(0, 500);
      await sendMedia(client.phone, pdfUrl, caption);

      await db.from('programs').update({
        whatsapp_sent_at: new Date().toISOString()
      }).eq('client_id', client_id).eq('week_no', week_no);
    }

    console.log(`[PROGRAM] Generated Week ${week_no} for ${maskPhone(client.phone)}`);

    return jsonResponse(res, 200, {
      ok: true,
      client_id,
      week_no,
      pdf_url: pdfUrl
    });
  } catch (err) {
    console.error(`[GENERATE ERROR] ${err.message}`);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
};
