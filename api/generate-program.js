const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { sendText, maskPhone } = require('./_lib/whatsapp');
const { MADDY_PHONE } = require('./_lib/constants');

const anthropic = new Anthropic();

const BANNED_SUBSTANCES = [
  'steroid',
  'sarm',
  'clenbuterol',
  'dnp',
  'ephedra',
  'hgh',
  'testosterone',
  'anavar',
  'dianabol',
  'trenbolone',
  'winstrol',
];

const SYSTEM_PROMPT = `You are Maddy's program architect. Generate a weekly workout and nutrition plan for a fitness client. Output valid JSON with two keys: workout_plan and nutrition_plan. workout_plan should have 5-6 training days with exercises, sets, reps, rest. nutrition_plan should have daily macros, meal timing, and 3-4 meal options. Adjust based on check-in data: if compliance is low, simplify. If energy is low, reduce volume. If weight stalled, adjust nutrition. Never prescribe extreme calorie deficits below 1200cal, never mention supplements beyond basics (protein, creatine, multivitamin), never set unrealistic expectations.`;

function buildUserMessage(client, checkins, weekNo) {
  let msg = `Client Profile:\n`;
  msg += `- Name: ${client.name || 'N/A'}\n`;
  msg += `- Program: ${client.program}\n`;
  msg += `- Week: ${weekNo}\n`;
  msg += `- Goal: ${client.goal || 'General fitness'}\n`;
  msg += `- Age: ${client.age || 'N/A'}\n`;
  msg += `- Injuries: ${client.injuries || 'None reported'}\n`;
  msg += `- Diet preference: ${client.diet_preference || 'No preference'}\n`;
  msg += `- Schedule: ${client.schedule || 'Flexible'}\n`;

  if (checkins && checkins.length > 0) {
    msg += `\nRecent Check-ins:\n`;
    for (const ci of checkins) {
      msg += `\nWeek ${ci.week_no}:\n`;
      msg += `- Weight: ${ci.weight || 'N/A'}\n`;
      msg += `- Energy level: ${ci.energy || 'N/A'}\n`;
      msg += `- Compliance: ${ci.compliance_score || 'N/A'}\n`;
      msg += `- Issues: ${ci.issues || 'None'}\n`;
    }
  } else {
    msg += `\nNo previous check-in data available (first program week).\n`;
  }

  msg += `\nGenerate the program for Week ${weekNo}. Return valid JSON only.`;
  return msg;
}

function generateTextSummary(program, client, weekNo) {
  let summary = `Week ${weekNo} Program for ${client.name || 'Client'}\n`;
  summary += `Program: ${client.program}\n`;
  summary += `${'='.repeat(40)}\n\n`;

  if (program.workout_plan) {
    summary += `WORKOUT PLAN\n${'-'.repeat(20)}\n`;
    if (Array.isArray(program.workout_plan)) {
      for (const day of program.workout_plan) {
        summary += `\n${day.day || day.name || 'Training Day'}:\n`;
        if (Array.isArray(day.exercises)) {
          for (const ex of day.exercises) {
            summary += `  - ${ex.name || ex.exercise}: ${ex.sets || '?'}x${ex.reps || '?'}`;
            if (ex.rest) summary += ` (rest: ${ex.rest})`;
            summary += `\n`;
          }
        }
      }
    } else if (typeof program.workout_plan === 'object') {
      summary += JSON.stringify(program.workout_plan, null, 2) + '\n';
    }
  }

  if (program.nutrition_plan) {
    summary += `\nNUTRITION PLAN\n${'-'.repeat(20)}\n`;
    const np = program.nutrition_plan;
    if (np.daily_macros) {
      summary += `Daily Macros: ${JSON.stringify(np.daily_macros)}\n`;
    }
    if (np.calories) {
      summary += `Calories: ${np.calories}\n`;
    }
    if (np.meal_timing) {
      summary += `Meal Timing: ${np.meal_timing}\n`;
    }
    if (Array.isArray(np.meals || np.meal_options)) {
      const meals = np.meals || np.meal_options;
      summary += `\nMeal Options:\n`;
      for (const meal of meals) {
        if (typeof meal === 'string') {
          summary += `  - ${meal}\n`;
        } else {
          summary += `  - ${meal.name || meal.title || JSON.stringify(meal)}\n`;
        }
      }
    }
  }

  return summary;
}

function checkSafety(program) {
  const issues = [];

  // Check calorie minimum
  const np = program.nutrition_plan;
  if (np) {
    const calories =
      np.calories ||
      (np.daily_macros && np.daily_macros.calories) ||
      null;
    if (calories && Number(calories) < 1200) {
      issues.push(`Calories too low: ${calories}`);
    }
  }

  // Check for banned substances
  const programStr = JSON.stringify(program).toLowerCase();
  for (const substance of BANNED_SUBSTANCES) {
    if (programStr.includes(substance)) {
      issues.push(`Banned substance mentioned: ${substance}`);
    }
  }

  return issues;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { client_id, week_no } = req.body || {};

    if (!client_id || !week_no) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['client_id', 'week_no'],
      });
    }

    // Fetch client profile
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (clientError || !client) {
      console.error(
        `Client fetch failed for ${client_id}:`,
        clientError?.message || 'not found'
      );
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch last 2 check-ins
    const { data: checkins, error: checkinError } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    if (checkinError) {
      console.error(
        `Check-in fetch failed for ${maskPhone(client.phone)}:`,
        checkinError.message
      );
    }

    // Call Claude API
    const userMessage = buildUserMessage(client, checkins || [], week_no);

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract text from response
    const responseText =
      response.content && response.content[0] && response.content[0].text
        ? response.content[0].text
        : '';

    // Parse JSON from Claude response (handle markdown code blocks)
    let programData;
    try {
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : responseText.trim();
      programData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error(
        `Failed to parse Claude response for ${maskPhone(client.phone)}:`,
        parseErr.message
      );
      return res.status(500).json({ error: 'Failed to parse generated program' });
    }

    // Safety check
    const safetyIssues = checkSafety(programData);
    const needsReview = safetyIssues.length > 0;

    // Store in programs table
    const { data: programRecord, error: insertError } = await supabase
      .from('programs')
      .insert({
        client_id,
        week_no,
        workout_plan: programData.workout_plan,
        nutrition_plan: programData.nutrition_plan,
        notes: needsReview
          ? `NEEDS REVIEW: ${safetyIssues.join('; ')}`
          : null,
      })
      .select()
      .single();

    if (insertError) {
      console.error(
        `Failed to store program for ${maskPhone(client.phone)}:`,
        insertError.message
      );
      return res.status(500).json({ error: 'Failed to store program' });
    }

    // Generate text summary (no PDF lib available)
    const summary = generateTextSummary(programData, client, week_no);

    // Upload summary to Supabase Storage
    const storagePath = `clients/${client_id}/week_${week_no}.txt`;
    const { error: uploadError } = await supabase.storage
      .from('programs')
      .upload(storagePath, Buffer.from(summary, 'utf-8'), {
        contentType: 'text/plain',
        upsert: true,
      });

    if (uploadError) {
      console.error(
        `Failed to upload summary for ${maskPhone(client.phone)}:`,
        uploadError.message
      );
      // Non-fatal: continue even if upload fails
    }

    // If needs review, notify Maddy instead of sending to client
    if (needsReview) {
      await sendText(
        MADDY_PHONE,
        `Program generated for ${client.name || maskPhone(client.phone)} (Week ${week_no}) needs review.\nIssues: ${safetyIssues.join(', ')}\nPlease review in admin dashboard.`
      );
      console.log(
        `Program for ${maskPhone(client.phone)} flagged for review: ${safetyIssues.join(', ')}`
      );
    } else {
      // Send summary to client via WhatsApp
      const truncatedSummary =
        summary.length > 1500
          ? summary.substring(0, 1500) + '\n\n... (full plan available in your portal)'
          : summary;

      await sendText(client.phone, truncatedSummary);
      console.log(
        `Program sent to ${maskPhone(client.phone)} for week ${week_no}`
      );
    }

    return res.status(200).json({
      success: true,
      program_id: programRecord.id,
      needs_review: needsReview,
    });
  } catch (err) {
    console.error('generate-program error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
