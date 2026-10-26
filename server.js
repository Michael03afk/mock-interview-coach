require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory rate limiting: 20 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.startTime > RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

function rateLimiter(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.startTime > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({
      error: 'Rate limit exceeded. You may only make 20 requests per minute. Please try again shortly.'
    });
  }

  record.count++;
  next();
}

app.use('/api/', rateLimiter);

// Multer memory storage (max 5 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isPdfMime = file.mimetype === 'application/pdf';
    const isPdfExt = /\.pdf$/i.test(file.originalname);
    if (isPdfMime || isPdfExt) {
      cb(null, true);
    } else {
      const err = new Error('INVALID_FILE_TYPE');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  }
});

// Allowed domain, level, and count values
const ALLOWED_DOMAINS = [
  'Web development',
  'Data and AI',
  'Embedded and IoT',
  'VLSI and electronics',
  'HR and behavioral'
];
const ALLOWED_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const ALLOWED_COUNTS = [3, 5, 8, 10];

/**
 * AI Service Integration
 * Centralized callAI function for the Antigravity / Gemini API.
 * Includes a 30s timeout and 1 automatic retry on failure.
 * Never logs or reveals the API key or raw resume text.
 */
async function callAI(prompt) {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not configured in the environment variables.');
  }

  const primaryModel = process.env.AI_MODEL || 'gemini-3-flash-preview';
  const fallbackModel = 'gemini-3.5-flash';

  const singleCall = async (modelName) => {
    const endpoint = process.env.AI_API_URL || `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`AI provider (${modelName}) returned status ${response.status}: ${errorText.slice(0, 150)}`);
      }

      const data = await response.json();
      const content = data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== 'string') {
        throw new Error('Received empty or unrecognized response structure from AI provider.');
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await singleCall(primaryModel);
  } catch (initialErr) {
    console.warn(`[AI] Initial attempt with ${primaryModel} failed (${initialErr.name || 'Error'}: ${initialErr.message}). Retrying once...`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // Retry with fallback model if primary wasn't explicitly overridden to a custom URL
    const retryModel = process.env.AI_API_URL ? primaryModel : fallbackModel;
    return await singleCall(retryModel);
  }
}

/**
 * Safely parses JSON output from AI text, stripping Markdown code fences
 */
function parseJsonFromAi(raw) {
  let cleaned = raw.trim();
  // Strip ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // If there's still wrapping text, try to extract array or object boundaries
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBracket !== -1 && lastBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  } else if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(cleaned);
}

// ------------------- ROUTES -------------------

// Health check
app.get('/api/health', (req, res) => {
  return res.json({ ok: true });
});

// Generate Interview Questions
app.post('/api/questions', (req, res) => {
  upload.single('resume')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Resume file size exceeds the 5 MB limit. Please compress it and try again.' });
        }
        if (uploadErr.code === 'INVALID_FILE_TYPE') {
          return res.status(400).json({ error: 'Uploaded file is not a valid PDF. Please upload a PDF file.' });
        }
        return res.status(400).json({ error: 'File upload error: ' + uploadErr.message });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Please upload your resume in PDF format.' });
      }

      const { domain, level, count } = req.body;
      const parsedCount = parseInt(count, 10);
      const cleanDomain = typeof domain === 'string' ? domain.trim().slice(0, 100) : '';

      // Validation
      if (!cleanDomain) {
        return res.status(400).json({
          error: 'Please enter a target domain/role or select one from the options.'
        });
      }

      if (!ALLOWED_LEVELS.includes(level)) {
        return res.status(400).json({
          error: `Invalid level. Must be one of: ${ALLOWED_LEVELS.join(', ')}`
        });
      }

      if (!ALLOWED_COUNTS.includes(parsedCount)) {
        return res.status(400).json({
          error: `Invalid question count. Must be one of: ${ALLOWED_COUNTS.join(', ')}`
        });
      }

      // Extract resume text using pdf-parse
      let resumeText = '';
      try {
        const pdfData = await pdfParse(req.file.buffer);
        resumeText = pdfData.text ? pdfData.text.replace(/\s+/g, ' ').trim() : '';
      } catch (pdfErr) {
        return res.status(400).json({
          error: 'Could not extract text from the PDF. Please ensure the file is an unencrypted, valid PDF.'
        });
      }

      if (!resumeText || resumeText.length < 25) {
        return res.status(400).json({
          error: 'The uploaded PDF contains no readable text. Please upload a text-based PDF resume rather than an image or scanned document.'
        });
      }

      // Limit prompt context length safely (e.g. up to ~8000 characters)
      const sanitizedResumeSummary = resumeText.slice(0, 8000);

      const prompt = `You are a professional technical interviewer for the domain "${cleanDomain}" at the "${level}" seniority level.
Below is the text extracted from the candidate's resume:
---
${sanitizedResumeSummary}
---

Your task:
Generate exactly ${parsedCount} interview questions for this candidate.
Guidelines:
1. Calibrate question complexity strictly to the "${level}" level.
2. Mix questions referencing the candidate's specific projects, tools, frameworks, and experience found in their resume with essential fundamental and situational questions in "${cleanDomain}".
3. Each question must be clear, direct, and answerable out loud in approximately 90 seconds.
4. Output format: You MUST return ONLY a valid JSON array of exactly ${parsedCount} strings. Do NOT include markdown code blocks, prefixes, explanations, or numbers before the strings.

Example response format:
["First question here?", "Second question here?"]`;

      let aiRawResponse;
      try {
        aiRawResponse = await callAI(prompt);
      } catch (aiErr) {
        console.error('[AI Error]', aiErr.message);
        return res.status(502).json({
          error: 'The AI service is temporarily unavailable or timed out. Please verify your API key and try again.'
        });
      }

      let questionsArray;
      try {
        const parsed = parseJsonFromAi(aiRawResponse);
        if (Array.isArray(parsed) && parsed.length > 0) {
          questionsArray = parsed.map((q) => (typeof q === 'string' ? q : JSON.stringify(q)));
        } else {
          throw new Error('AI output was not a valid array');
        }
      } catch (parseErr) {
        console.error('[JSON Parse Error]', parseErr.message);
        return res.status(502).json({
          error: 'Failed to parse interview questions from the AI model response.'
        });
      }

      // Ensure exact count requested
      if (questionsArray.length > parsedCount) {
        questionsArray = questionsArray.slice(0, parsedCount);
      }

      return res.json({ questions: questionsArray });
    } catch (err) {
      console.error('[Server Error]', err.message);
      return res.status(500).json({ error: 'An unexpected server error occurred while processing questions.' });
    }
  });
});

// Evaluate Interview Answer and Give Feedback
app.post('/api/feedback', async (req, res) => {
  try {
    const { question, answer, domain, level } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'A valid question string is required.' });
    }

    const trimmedAnswer = typeof answer === 'string' ? answer.trim() : '';

    // If answer was skipped or empty, return 0 score immediately without calling AI
    if (!trimmedAnswer) {
      return res.json({
        score: 0,
        strengths: 'None observed. The question was skipped or submitted without an answer.',
        improvements: 'Try attempting every question. Even outline key terms, architecture components, or a problem-solving strategy when you are unsure.',
        sampleAnswer: `For the question "${question}", a strong response would define the core concept clearly, explain practical trade-offs or design considerations, and illustrate with a relevant project example.`
      });
    }

    const prompt = `You are an expert interview coach evaluating a candidate's verbal/written answer.
Domain: ${domain || 'General Engineering'}
Level: ${level || 'Intermediate'}
Interview Question: "${question}"
Candidate's Answer: "${trimmedAnswer}"

Task:
Score the candidate's answer from 1 to 10 (1 = completely off-topic or incorrect, 10 = world-class, nuanced, and comprehensive answer for the ${level} level).
Provide concise, actionable evaluation.

Output format:
Return ONLY a valid JSON object with the following exact keys:
{
  "score": <integer from 1 to 10>,
  "strengths": "<What the candidate explained well or positive aspects>",
  "improvements": "<Specific gaps, missing edge cases, or ways to make the answer sharper>",
  "sampleAnswer": "<A concise, exemplary 90-second answer to this question>"
}
Do NOT return markdown backticks or explanations outside the JSON object.`;

    let aiRawResponse;
    try {
      aiRawResponse = await callAI(prompt);
    } catch (aiErr) {
      console.error('[AI Feedback Error]', aiErr.message);
      return res.status(502).json({
        error: 'The AI service failed to evaluate feedback. Please try again.'
      });
    }

    let feedback;
    try {
      const parsed = parseJsonFromAi(aiRawResponse);
      const rawScore = Number(parsed.score);
      const normalizedScore = isNaN(rawScore) ? 5 : Math.max(1, Math.min(10, Math.round(rawScore)));

      feedback = {
        score: normalizedScore,
        strengths: parsed.strengths || 'Answer addressed the basic prompt requirements.',
        improvements: parsed.improvements || 'Consider providing more concrete metrics or architectural trade-offs.',
        sampleAnswer: parsed.sampleAnswer || 'A great answer directly states the approach, compares alternatives, and concludes with lessons learned.'
      };
    } catch (parseErr) {
      console.error('[Feedback Parse Error]', parseErr.message);
      return res.status(502).json({
        error: 'Failed to parse feedback data from the AI model response.'
      });
    }

    return res.json(feedback);
  } catch (err) {
    console.error('[Server Error]', err.message);
    return res.status(500).json({ error: 'An unexpected error occurred while generating feedback.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err.message);
  res.status(500).json({ error: 'An unexpected internal error occurred.' });
});

app.listen(PORT, () => {
  console.log(`AI Mock Interview Coach server running on port ${PORT}`);
  console.log(`Local URL: http://localhost:${PORT}`);
});
