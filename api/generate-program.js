const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { buildProgramPrompt } = require('../lib/program-prompt');
const { generateProgramPDF } = require('../lib/pdf');

/**
 * Masks a phone number for safe logging.
 */
function maskPhone(phone) {
  if (!phone || phone.length < 6) return '***';
  return phone.slice(0, -4).replace(/.(?=.{4})/g, '*').slice(0, -4) + phone.slice(-4);
}

/**
 * Safety check: verify the nutrition plan meets minimum calorie thresholds
 * and contains no flagged content.
 */
function safetyCheck(workoutPlan, nutritionPlan, clientGender) {
  const issues = [];

  if (nutritionPlan && nutritionPlan.daily_calories) {
    const minCalories = clientGender === 'male' ? 1500 : 1200;
    if (nutritionPlan.daily_calories < minCalories) {
      issues.push(
        `Calories ${nutritionPlan.daily_calories} below minimum ${minCalories} for ${clientGender || 'unknown gender'}`
      );
    }
  }

  // Check for flagged supplement/substance references in the full plan JSON
  const planText = JSON.stringify({ workoutPlan, nutritionPlan }).toLowerCase();
  const flaggedTerms = [
    'steroid',
    'sarm',
    'clenbuterol',
    'dnp',
    'ephedrine',
    'fat burner',
    'testosterone injection',
  ];

  for (const term of flaggedTerms) {
    if (planText.includes(term)) {
      issues.push(`Flagged content detected: "${term}"`);
    }
  }

  return issues;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    /* -- Auth check: require internal API secret -- */
    const apiSecret = process.env.API_SECRET;
    if (apiSecret && req.headers['x-api-secret'] !== apiSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = getSupabase();
    const { client_id: clientId, week_no: weekNo } = req.body || {};

    if (!clientId || !weekNo) {
      return res
        .status(400)
        .json({ error: 'Missing required fields: client_id, week_no' });
    }

    /* -- Fetch client profile from clients + linked lead data -- */
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Fetch linked lead data for intake info
    let leadData = null;
    if (client.phone) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', client.phone)
        .maybeSingle();
      leadData = lead;
    }

    const intakeData = (leadData && leadData.intake_data) || {};

    /* -- Fetch last 2 check-ins from checkins table -- */
    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', clientId)
      .order('week_no', { ascending: false })
      .limit(2);

    /* -- Build the client profile object for the prompt -- */
    const clientProfile = {
      name: client.name || intakeData.name || 'Client',
      gender: intakeData.gender || 'female',
      age: intakeData.age || leadData?.age || null,
      weight_kg: intakeData.weight_kg || intakeData.weight || null,
      height_cm: intakeData.height_cm || intakeData.height || null,
      goal: intakeData.goal || leadData?.goal || client.program_type || 'general fitness',
      experience_level: intakeData.experience_level || 'beginner',
      equipment: intakeData.equipment || 'full gym',
      dietary_preference: intakeData.diet_preference || intakeData.dietary_preference || 'non-veg',
      allergies: intakeData.allergies || null,
      injuries: intakeData.injuries || null,
      training_days: intakeData.training_days || 5,
      market: leadData?.market || 'IN',
      week_number: weekNo,
    };

    /* -- Map check-in data to prompt format -- */
    const lastCheckins = (recentCheckins || []).map((c) => ({
      week_number: c.week_no,
      date: c.created_at,
      weight_kg: c.weight,
      energy_level: c.energy,
      adherence: c.compliance_score,
      notes: c.issues,
    }));

    /* -- Call Claude API with the program prompt -- */
    const { system, userMessage } = buildProgramPrompt(clientProfile, lastCheckins);

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });

    /* -- Parse the JSON response -- */
    const responseText =
      response.content &&
      response.content[0] &&
      response.content[0].type === 'text'
        ? response.content[0].text
        : '';

    let programData;
    try {
      // Try to extract JSON from the response (handle possible markdown fences)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON object found in Claude response');
      }
      programData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error(
        `generate-program: failed to parse Claude response [client:${clientId}]:`,
        parseErr.message
      );
      return res.status(500).json({ error: 'Failed to parse program response' });
    }

    const workoutPlan = programData.workout_plan || null;
    const nutritionPlan = programData.nutrition_plan || null;
    const notes = programData.notes || '';

    /* -- Safety check -- */
    const safetyIssues = safetyCheck(workoutPlan, nutritionPlan, clientProfile.gender);

    if (safetyIssues.length > 0) {
      console.error(
        `generate-program: safety check failed [client:${clientId}]:`,
        safetyIssues.join('; ')
      );

      // Insert into programs table flagged for review
      await supabase.from('programs').insert({
        client_id: clientId,
        week_no: weekNo,
        workout_plan: workoutPlan,
        nutrition_plan: nutritionPlan,
        notes,
        status: 'flagged',
        safety_issues: safetyIssues,
        created_at: new Date().toISOString(),
      });

      // Notify Maddy about the flagged program
      const maddyPhone = process.env.MADDY_PHONE || '';
      if (maddyPhone) {
        await sendWhatsApp(maddyPhone, 'program_flagged_v1', {
          client_name: clientProfile.name,
          week_no: weekNo,
          issues: safetyIssues.join(', '),
        });
      }

      return res.status(200).json({
        success: false,
        flagged: true,
        safety_issues: safetyIssues,
      });
    }

    /* -- Generate branded PDF -- */
    const pdfBuffer = await generateProgramPDF(
      clientProfile.name,
      weekNo,
      workoutPlan,
      nutritionPlan
    );

    /* -- Upload PDF to Supabase Storage -- */
    const pdfPath = `clients/${clientId}/week_${weekNo}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from('uploads')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadErr) {
      console.error(
        `generate-program: PDF upload failed [client:${clientId}]:`,
        uploadErr.message
      );
      return res.status(500).json({ error: 'Failed to upload program PDF' });
    }

    /* -- Get public URL for the PDF -- */
    const { data: publicUrlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(pdfPath);

    const pdfUrl = publicUrlData ? publicUrlData.publicUrl : '';

    /* -- Send via WhatsApp with context note -- */
    await sendWhatsApp(client.phone, 'weekly_program_v1', {
      name: clientProfile.name,
      week_no: weekNo,
      pdf_url: pdfUrl,
      notes: notes || `Here is your Week ${weekNo} program. Stay consistent!`,
      media: {
        url: pdfUrl,
        filename: `FitnessByMaddy_Week${weekNo}.pdf`,
      },
    });

    /* -- Insert into programs table -- */
    await supabase.from('programs').insert({
      client_id: clientId,
      week_no: weekNo,
      workout_plan: workoutPlan,
      nutrition_plan: nutritionPlan,
      notes,
      pdf_url: pdfUrl,
      status: 'sent',
      created_at: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, pdf_url: pdfUrl });
  } catch (err) {
    const safeClient = (req.body || {}).client_id || 'unknown';
    console.error(`generate-program error [client:${safeClient}]:`, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
