const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('../lib/supabase');
const { generateProgramPDF } = require('../lib/pdf');
const { sendDocument } = require('../lib/whatsapp');

const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const SYSTEM_PROMPT = `You are a certified fitness program architect working for Fitness by Maddy, an elite online coaching brand. You design weekly workout and nutrition plans that are:
- Science-backed and safe
- Progressive (builds on previous weeks)
- Personalised to the client's profile, goals, and check-in data
- Practical and clearly structured

CRITICAL SAFETY RULES:
- Never prescribe calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, or extreme supplements
- Never suggest more than 6 training days per week
- Always include rest days
- If a client reports pain or injury, reduce load and recommend professional assessment
- For PCOS clients: prioritize resistance training, moderate cardio, anti-inflammatory nutrition
- For 40+ clients: prioritize joint-friendly movements, adequate recovery, bone density work

Output ONLY valid JSON with this structure:
{
  "workout": {
    "days": [
      {
        "name": "Day 1 - Upper Body Push",
        "focus": "Chest, Shoulders, Triceps",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ]
      }
    ]
  },
  "nutrition": {
    "calories": 2000,
    "protein": 150,
    "carbs": 200,
    "fats": 70,
    "meals": [
      { "name": "Meal 1 - Breakfast", "items": ["4 egg whites + 1 whole egg", "1 cup oats"], "notes": "" }
    ]
  },
  "notes": "One paragraph coach note for the client about this week's focus."
}`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*, leads!clients_lead_id_fkey(*)')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get intake data
    const { data: intake } = await supabase
      .from('intake_submissions')
      .select('*')
      .eq('lead_id', client.lead_id)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get previous program for continuity
    const { data: prevProgram } = await supabase
      .from('programs')
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    // Build prompt
    const clientProfile = {
      name: client.name,
      program: client.program,
      week: week_no,
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        height: intake.height,
        weight: intake.current_weight,
        goalWeight: intake.goal_weight,
        goal: intake.primary_goal,
        injuries: intake.injuries,
        medical: intake.medical_conditions,
        diet: intake.diet_preference,
        equipment: intake.available_equipment,
        daysPerWeek: intake.days_per_week,
        experience: intake.workout_experience
      } : {},
      recentCheckins: (checkins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues
      })),
      previousProgram: prevProgram ? {
        workout: prevProgram.workout_plan,
        nutrition: prevProgram.nutrition_plan
      } : null
    };

    const userPrompt = `Generate Week ${week_no} program for this client:\n${JSON.stringify(clientProfile, null, 2)}`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const responseText = message.content[0].text;
    let programData;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      programData = JSON.parse(jsonMatch ? jsonMatch[0] : responseText);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', parseErr.message);
      return res.status(500).json({ error: 'Failed to parse program' });
    }

    // Safety check on nutrition
    if (programData.nutrition && programData.nutrition.calories) {
      const minCal = (intake && intake.gender === 'female') ? 1200 : 1500;
      if (programData.nutrition.calories < minCal) {
        console.error('SAFETY: Calories below minimum — halting');
        return res.status(400).json({ error: 'Generated program failed safety check — calories too low' });
      }
    }

    // Generate PDF
    const pdfBuffer = await generateProgramPDF(
      client,
      week_no,
      programData.workout,
      programData.nutrition,
      programData.notes
    );

    // Upload PDF to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}.pdf`;
    await supabase.storage.from('clients').upload(pdfPath, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });
    const { data: pdfUrlData } = supabase.storage.from('clients').getPublicUrl(pdfPath);
    const pdfUrl = pdfUrlData.publicUrl;

    // Save to programs table (audit trail)
    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: programData.workout,
      nutrition_plan: programData.nutrition,
      notes: programData.notes
    }).select().single();

    if (error) throw error;

    // Send via WhatsApp
    const contextNote = programData.notes
      ? programData.notes.substring(0, 200)
      : `Your Week ${week_no} program is ready!`;

    await sendDocument(client.phone, pdfUrl, contextNote, true);

    // Update program with send timestamp
    await supabase.from('programs').update({
      whatsapp_sent_at: new Date().toISOString()
    }).eq('id', program.id);

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
};
