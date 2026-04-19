const { supabase } = require('../lib/supabase');
const { generateWeeklyProgram } = require('../lib/program-generator');
const { generateProgramPDF, uploadPDF } = require('../lib/pdf-generator');
const { sendTemplate } = require('../lib/whatsapp');
const { handleCors, maskPhone } = require('../lib/helpers');
const { createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { client_id, week_no } = req.body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: existingProgram } = await supabase
      .from('programs')
      .select('id')
      .eq('client_id', client_id)
      .eq('week_no', parseInt(week_no))
      .single();

    if (existingProgram) {
      return res.status(409).json({ error: 'Program already generated for this week' });
    }

    const result = await generateWeeklyProgram(client_id, parseInt(week_no));

    if (!result.success) {
      if (result.flagged) {
        await createEscalation(
          client.phone,
          `Unsafe program content flagged: ${result.reason}`,
          `Week ${week_no} program for ${client.name || maskPhone(client.phone)} flagged for review`,
          client_id
        );
        return res.status(200).json({
          success: false,
          flagged: true,
          reason: result.reason,
          message: 'Program flagged for Maddy review'
        });
      }
      return res.status(500).json({ error: 'Program generation failed' });
    }

    const pdfBuffer = await generateProgramPDF(
      {
        week_no: parseInt(week_no),
        workout_plan: result.program.workout_plan,
        nutrition_plan: result.program.nutrition_plan,
        notes: result.program.notes
      },
      client.name
    );

    const pdfUrl = await uploadPDF(pdfBuffer, client_id, parseInt(week_no));

    await sendTemplate(client.phone, 'weekly_program', [
      client.name || 'there',
      String(week_no),
      result.program.notes || 'Check out your new program!',
      pdfUrl
    ]);

    await supabase
      .from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('id', result.program.id);

    return res.status(200).json({
      success: true,
      program_id: result.program.id,
      pdf_url: pdfUrl,
      week_no: parseInt(week_no)
    });
  } catch (err) {
    console.error('[GenerateProgram] Error:', err.message);
    return res.status(500).json({ error: 'Program generation failed', details: err.message });
  }
};
