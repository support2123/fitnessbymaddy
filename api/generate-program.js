import Anthropic from '@anthropic-ai/sdk';
import supabase from './lib/supabase.js';
import { sendTemplate, sendToMaddy } from './lib/whatsapp.js';
import { maskPhone, PROGRAM_INFO } from './lib/utils.js';

const SAFETY_FLAGS = [
  'extreme calorie', 'very low calorie', 'under 1000', 'under 800',
  'steroid', 'sarm', 'clenbuterol', 'dnp', 'ephedra',
  'lose 10kg in 1 week', 'lose 20 pounds in',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(f => lower.includes(f));
}

async function generatePDF(workout, nutrition, clientName, weekNo) {
  const sections = [];
  sections.push(`FITNESS BY MADDY — WEEK ${weekNo} PROGRAM`);
  sections.push(`Client: ${clientName || 'Client'}\n`);
  sections.push('═══════════════════════════════════════');
  sections.push('WORKOUT PLAN');
  sections.push('═══════════════════════════════════════\n');

  if (workout.days) {
    for (const day of workout.days) {
      sections.push(`▸ ${day.day} — ${day.focus}`);
      if (day.exercises) {
        for (const ex of day.exercises) {
          sections.push(`  ${ex.name}: ${ex.sets} sets × ${ex.reps} reps | Rest: ${ex.rest || '60s'}`);
          if (ex.notes) sections.push(`    Note: ${ex.notes}`);
        }
      }
      if (day.cardio) sections.push(`  Cardio: ${day.cardio}`);
      sections.push('');
    }
  }

  sections.push('═══════════════════════════════════════');
  sections.push('NUTRITION PLAN');
  sections.push('═══════════════════════════════════════\n');

  if (nutrition.calories) {
    sections.push(`Daily Targets: ${nutrition.calories} kcal | P: ${nutrition.protein}g | C: ${nutrition.carbs}g | F: ${nutrition.fat}g\n`);
  }

  if (nutrition.meals) {
    for (const meal of nutrition.meals) {
      sections.push(`▸ ${meal.name} (${meal.time || ''})`);
      if (meal.options) {
        for (const opt of meal.options) {
          sections.push(`  - ${opt}`);
        }
      }
      sections.push('');
    }
  }

  if (nutrition.supplements) {
    sections.push('Supplements: ' + nutrition.supplements.join(', '));
  }
  if (nutrition.hydration) {
    sections.push('Hydration: ' + nutrition.hydration);
  }
  if (nutrition.notes) {
    sections.push('\nNotes: ' + nutrition.notes);
  }

  return sections.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    // Get client data
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Get last 2 check-ins
    const { data: checkins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    // Get intake data if available
    const { data: intake } = await supabase
      .from('intake_data')
      .select('*')
      .eq('lead_id', client.lead_id)
      .single();

    // Build prompt for Claude
    const clientContext = {
      name: client.name,
      program: client.program,
      weekNumber: week_no,
      totalWeeks: PROGRAM_INFO[client.program]?.weeks || 12,
      recentCheckins: (checkins || []).map(c => ({
        week: c.week_no,
        weight: c.weight,
        waist: c.waist,
        compliance: c.compliance_score,
        energy: c.energy,
        issues: c.issues,
      })),
      intake: intake ? {
        age: intake.age,
        gender: intake.gender,
        height: intake.height,
        weight: intake.weight,
        goal: intake.goal,
        injuries: intake.injuries,
        dietPreference: intake.diet_preference,
        experience: intake.training_experience,
        equipment: intake.equipment_access,
        schedule: intake.schedule,
      } : null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `You are a certified personal trainer and nutrition coach creating a weekly program for a client.

CLIENT DATA:
${JSON.stringify(clientContext, null, 2)}

Generate a week ${week_no} program. Return ONLY valid JSON with this exact structure:
{
  "workout_plan": {
    "days": [
      {
        "day": "Monday",
        "focus": "Upper Body Push",
        "exercises": [
          { "name": "Exercise Name", "sets": 4, "reps": "8-10", "rest": "90s", "notes": "" }
        ],
        "cardio": "optional cardio note"
      }
    ]
  },
  "nutrition_plan": {
    "calories": 2200,
    "protein": 180,
    "carbs": 220,
    "fat": 70,
    "meals": [
      {
        "name": "Meal 1 - Breakfast",
        "time": "7:00 AM",
        "options": ["Option 1 description", "Option 2 description"]
      }
    ],
    "supplements": ["Whey Protein", "Creatine"],
    "hydration": "3-4L water daily",
    "notes": "Additional notes"
  },
  "weekly_notes": "Brief motivational note and focus for this week"
}

Rules:
- Design 5-6 training days with 1-2 rest days
- Progressive overload from previous weeks if check-in data available
- If client reported issues, adapt accordingly
- Use evidence-based recommendations only
- Never recommend extreme calorie deficits (below 1200 for women, 1500 for men)
- Never recommend banned substances or supplements
- Keep it practical and achievable`,
      }],
    });

    const aiText = response.content[0].text;

    // Safety check
    if (hasSafetyIssue(aiText)) {
      await supabase.from('escalations').insert({
        phone: client.phone,
        client_id,
        trigger: 'unsafe_program',
        message: `Week ${week_no} program flagged for safety review`,
      });
      await sendToMaddy(
        `⚠️ PROGRAM SAFETY FLAG\nClient: ${client.name || maskPhone(client.phone)}\nWeek ${week_no}\nProgram flagged for review before sending.`
      );
      return res.status(200).json({ ok: false, reason: 'safety_flagged' });
    }

    // Parse the JSON response
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON' });
    }
    const programData = JSON.parse(jsonMatch[0]);

    // Generate text-based PDF content
    const pdfContent = await generatePDF(
      programData.workout_plan,
      programData.nutrition_plan,
      client.name,
      week_no
    );

    // Upload to Supabase Storage
    const pdfPath = `clients/${client_id}/week_${week_no}_program.txt`;
    const { error: uploadErr } = await supabase.storage
      .from('client-files')
      .upload(pdfPath, pdfContent, {
        contentType: 'text/plain',
        upsert: true,
      });

    let pdfUrl = null;
    if (!uploadErr) {
      const { data: urlData } = supabase.storage.from('client-files').getPublicUrl(pdfPath);
      pdfUrl = urlData.publicUrl;
    }

    // Save to programs table
    await supabase.from('programs').upsert({
      client_id,
      week_no,
      generated_at: new Date().toISOString(),
      pdf_url: pdfUrl,
      workout_plan: programData.workout_plan,
      nutrition_plan: programData.nutrition_plan,
      notes: programData.weekly_notes || null,
    }, { onConflict: 'client_id,week_no' });

    // Send via WhatsApp
    const contextNote = programData.weekly_notes
      ? `Week ${week_no} focus: ${programData.weekly_notes.slice(0, 100)}`
      : `Your Week ${week_no} program is ready!`;

    await sendTemplate(
      client.phone,
      'weekly_program',
      [client.name || 'there', String(week_no), contextNote],
      client.name
    );

    // Update whatsapp_sent_at
    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({ ok: true, week_no, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
