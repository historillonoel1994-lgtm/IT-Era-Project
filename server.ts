import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { PDFParse } from 'pdf-parse';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Shared Gemini AI Client Utility
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

const PRIMARY_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

// Robust JSON string cleaner to handle markdown code blocks or edge whitespace
function cleanJsonString(str: string): string {
  if (!str) return '{}';
  let cleaned = str.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

// Call Gemini with automatic retry on 503/429 and secondary model fallback
async function generateContentWithRetry(options: {
  contents: any;
  config?: any;
  preferredModel?: string;
}): Promise<any> {
  const modelsToTry = [
    options.preferredModel || PRIMARY_MODEL,
    FALLBACK_MODEL,
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: options.contents,
          config: options.config,
        });

        if (response && response.text) {
          return response;
        }
      } catch (err: any) {
        lastError = err;
        const msg = String(err.message || '');
        const isTransient =
          msg.includes('503') ||
          msg.includes('429') ||
          msg.includes('UNAVAILABLE') ||
          msg.includes('high demand') ||
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('overloaded');

        if (isTransient && attempt === 0) {
          // Wait 1.2s before quick retry
          await new Promise((resolve) => setTimeout(resolve, 1200));
          continue;
        }
        break;
      }
    }
  }

  throw lastError;
}

// Helper to format lesson pages for prompt context
function formatLessonContext(pages: { pageNumber: number | string; text: string }[]): string {
  return pages
    .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.text}\n--- END PAGE ${p.pageNumber} ---`)
    .join('\n\n');
}

// 1. PDF Parser Endpoint (Extracts page-by-page text)
app.post('/api/parse-pdf', async (req: Request, res: Response) => {
  let parser: PDFParse | null = null;
  try {
    const { pdfBase64, filename } = req.body;
    if (!pdfBase64) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    // Clean base64 header if present
    const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
    const dataBuffer = Buffer.from(base64Data, 'base64');

    parser = new PDFParse({ data: dataBuffer });
    const textResult = await parser.getText();

    const pages = (textResult.pages || []).map((p, idx) => ({
      pageNumber: p.num || idx + 1,
      text: p.text.trim().length > 0 ? p.text.trim() : `[Page ${p.num || idx + 1} contains diagrams, charts, or scanned figures]`,
    }));

    const finalPages = pages.length > 0 ? pages : [
      { pageNumber: 1, text: textResult.text?.trim() || 'No readable text could be extracted.' }
    ];

    res.json({
      success: true,
      totalPages: finalPages.length,
      pages: finalPages,
      filename: filename || 'Uploaded_Document.pdf',
    });
  } catch (error: any) {
    console.error('Error parsing PDF:', error);
    res.status(500).json({
      error: 'Failed to parse PDF document. Please make sure the file is a valid PDF.',
      details: error.message,
    });
  } finally {
    if (parser) {
      try {
        await parser.destroy();
      } catch (e) {
        // ignore cleanup error
      }
    }
  }
});

// 2. FEATURE 1: Summarize Lesson
app.post('/api/summarize', async (req: Request, res: Response) => {
  try {
    const { pages, lessonTitle, subject } = req.body;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages to summarize' });
    }

    const lessonContext = formatLessonContext(pages);

    const prompt = `You are an expert educational summarizer for working college students who balance work shifts, classes, and family responsibilities. They have limited study time and need clear, high-yield summaries that are strictly grounded in their uploaded learning material.

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}
SUBJECT: ${subject || 'General Academic Subject'}

UPLOADED LESSON PAGES:
${lessonContext}

RESPONSIBLE AI SAFEGUARDS & INSTRUCTIONS:
1. You MUST base your summary strictly on the uploaded lesson text above.
2. NEVER invent, hallucinate, or extrapolate facts or page numbers.
3. Every key idea, important term, takeaway, and review note MUST be attributed to the exact source page number where it is found in the text.
4. If an idea spans multiple pages or is general synthesis, cite the primary source page.
5. Provide a short, direct citationExcerpt for key ideas verifying where it came from.
6. Make explanations crystal clear, encouraging, and easy for a fatigued working student to absorb quickly.

Generate the summary in JSON according to the schema.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mainTopic: {
              type: Type.STRING,
              description: 'The overarching topic or subject of the lesson.',
            },
            simpleExplanation: {
              type: Type.STRING,
              description: 'A plain, simple, jargon-free explanation written for a busy working student.',
            },
            keyIdeas: {
              type: Type.ARRAY,
              description: 'Core concepts with their verified page number and exact citation quote.',
              items: {
                type: Type.OBJECT,
                properties: {
                  idea: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER, description: 'The exact page number where this idea appears' },
                  citationExcerpt: { type: Type.STRING, description: 'Short verifiable quote from that page' },
                },
                required: ['idea', 'sourcePage'],
              },
            },
            importantTerms: {
              type: Type.ARRAY,
              description: 'Key vocabulary terms and concise definitions.',
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER, description: 'Source page where term is introduced' },
                },
                required: ['term', 'definition', 'sourcePage'],
              },
            },
            keyTakeaways: {
              type: Type.ARRAY,
              description: 'Essential practical takeaways to remember for exams or applications.',
              items: {
                type: Type.OBJECT,
                properties: {
                  takeaway: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                },
                required: ['takeaway', 'sourcePage'],
              },
            },
            quickReviewNotes: {
              type: Type.ARRAY,
              description: 'Rapid bulleted revision notes categorized by subheadings.',
              items: {
                type: Type.OBJECT,
                properties: {
                  heading: { type: Type.STRING },
                  bulletPoints: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  sourcePage: { type: Type.INTEGER },
                },
                required: ['heading', 'bulletPoints', 'sourcePage'],
              },
            },
          },
          required: ['mainTopic', 'simpleExplanation', 'keyIdeas', 'importantTerms', 'keyTakeaways', 'quickReviewNotes'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, summary: parsedData });
  } catch (error: any) {
    console.error('Error generating summary:', error);
    const msg = error.message || '';
    const userFriendlyMessage =
      msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')
        ? 'AI service is momentarily experiencing high traffic (503). Please click Retry in a few seconds.'
        : 'Failed to generate summary. Please check your connection and try again.';

    res.status(500).json({
      error: userFriendlyMessage,
      details: error.message,
    });
  }
});

// 3. FEATURE 2: Generate Quiz
app.post('/api/quiz', async (req: Request, res: Response) => {
  try {
    const { pages, lessonTitle, questionCount = 5, quizType = 'mixed' } = req.body;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages to generate a quiz' });
    }

    const count = [5, 10, 15].includes(Number(questionCount)) ? Number(questionCount) : 5;
    const lessonContext = formatLessonContext(pages);

    let typeInstruction = '';
    if (quizType === 'multiple_choice') {
      typeInstruction = 'Generate ONLY Multiple Choice questions (each with exactly 4 options: A, B, C, D text values).';
    } else if (quizType === 'true_false') {
      typeInstruction = 'Generate ONLY True or False questions (options must be ["True", "False"]).';
    } else {
      typeInstruction = 'Generate a balanced MIXED set of questions combining Multiple Choice (4 distinct options) and True or False (["True", "False"]).';
    }

    const prompt = `You are an academic examiner creating a practice quiz for working college students.

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}
NUMBER OF QUESTIONS REQUESTED: ${count}
QUIZ TYPE: ${quizType} (${typeInstruction})

UPLOADED LESSON PAGES:
${lessonContext}

RESPONSIBLE AI SAFEGUARDS & CRITICAL RULES:
1. Every single question MUST originate strictly from the uploaded lesson pages above.
2. DO NOT include questions or concepts that are absent from the learning material.
3. For EVERY question, identify the exact sourcePage where the answer is found.
4. Include a citationExcerpt: the exact sentence or clause from that page that proves the answer.
5. Provide a short, constructive explanation suitable for a student reviewing during a short study break.
6. The correctAnswer MUST exactly match one of the items in the options array.
7. Return exactly ${count} questions.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: 'Unique question id e.g. q1, q2' },
                  type: {
                    type: Type.STRING,
                    description: 'either "multiple_choice" or "true_false"',
                  },
                  question: { type: Type.STRING },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: '4 options for multiple choice; ["True", "False"] for true/false',
                  },
                  correctAnswer: { type: Type.STRING, description: 'Exact string matching one option' },
                  explanation: { type: Type.STRING, description: 'Short educational explanation' },
                  sourcePage: { type: Type.INTEGER, description: 'Exact page number in uploaded lesson' },
                  citationExcerpt: { type: Type.STRING, description: 'Verifying sentence from that page' },
                  topic: { type: Type.STRING, description: 'Specific concept or sub-topic tested' },
                },
                required: ['id', 'type', 'question', 'options', 'correctAnswer', 'explanation', 'sourcePage'],
              },
            },
          },
          required: ['questions'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{"questions":[]}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, questions: parsedData.questions || [] });
  } catch (error: any) {
    console.error('Error generating quiz:', error);
    const msg = error.message || '';
    const userFriendlyMessage =
      msg.includes('503') || msg.includes('high demand') || msg.includes('UNAVAILABLE')
        ? 'AI service is momentarily experiencing high traffic (503). Please click Retry in a few seconds.'
        : 'Failed to generate quiz questions. Please check your connection and try again.';

    res.status(500).json({
      error: userFriendlyMessage,
      details: error.message,
    });
  }
});

// 4. FEATURE 3: Ask Study Buddy (AI Tutor)
app.post('/api/ask-tutor', async (req: Request, res: Response) => {
  try {
    const { pages, lessonTitle, question, chatHistory = [] } = req.body;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'Please provide lesson pages for the tutor to reference' });
    }
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Please enter a question for Study Buddy' });
    }

    const lessonContext = formatLessonContext(pages);

    // Format previous turns for context
    const previousTurns = chatHistory
      .slice(-6)
      .map((msg: any) => `${msg.sender === 'user' ? 'Student' : 'Study Buddy'}: ${msg.text}`)
      .join('\n');

    const prompt = `You are "ASK STUDY BUDDY", a friendly, patient, and empowering AI tutor specifically built for working college students who balance work shifts and academic studies.

LESSON TITLE: ${lessonTitle || 'Uploaded Learning Material'}

UPLOADED LESSON PAGES:
${lessonContext}

RECENT CHAT CONTEXT:
${previousTurns || 'No previous messages'}

STUDENT QUESTION:
"${question}"

CRITICAL RESPONSIBLE AI SAFEGUARDS (MUST BE STRICTLY FOLLOWED):
1. Carefully search the uploaded lesson text before formulating your answer.
2. The answer MUST be simple, clear, student-friendly, and based strictly on the uploaded lesson.
3. Whenever possible, conclude or support your explanation with the exact source page number: "[Source: Page X]".
4. SAFEGUARD CLAUSE: If the student asks a question whose answer CANNOT be found, confirmed, or substantiated in the uploaded learning material, DO NOT guess or make up an answer.
In that case, you MUST explicitly display this exact safeguard statement:
"I could not find enough information in your uploaded lesson to answer this confidently. Please check your original lesson or ask your instructor."
You may add a gentle suggestion of what related topic is present in the lesson, but NEVER fabricate unsupported facts.
5. If the question asks for an example, step-by-step breakdown, or definition, ground your examples in the concepts taught in the text.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        systemInstruction: 'You are Study Buddy AI, an empathetic and strictly grounded tutor for working students.',
      },
    });

    const responseText = response.text || '';

    // Check if safeguard refusal was triggered
    const isSafeguardTriggered = responseText.includes('I could not find enough information in your uploaded lesson') ||
      responseText.includes('check your original lesson or ask your instructor');

    // Extract page number if present in text
    const pageMatch = responseText.match(/\[?Source:\s*Page\s*(\d+)\]?/i) || responseText.match(/Page\s*(\d+)/i);
    const sourcePage = pageMatch ? Number(pageMatch[1]) : undefined;

    res.json({
      success: true,
      answer: responseText,
      sourcePage: sourcePage,
      isSafeguardTriggered,
    });
  } catch (error: any) {
    console.error('Error in AI Tutor:', error);
    res.status(500).json({
      error: 'Study Buddy encountered a momentary connection issue. Please try again.',
      details: error.message,
    });
  }
});

// 5. SUPPORTING FEATURE: Work & Study Planner suggestions
app.post('/api/suggest-schedule', async (req: Request, res: Response) => {
  try {
    const { workSchedule = [], classSchedule = [], schoolTasks = [] } = req.body;

    const prompt = `You are a supportive academic advisor and time-management specialist for working college students.
A working student has provided their current commitments:

WORK SCHEDULE:
${JSON.stringify(workSchedule, null, 2)}

CLASS SCHEDULE:
${JSON.stringify(classSchedule, null, 2)}

PENDING SCHOOL TASKS & ASSIGNMENTS:
${JSON.stringify(schoolTasks, null, 2)}

CRITICAL GOALS & HEALTH RULES:
1. Working students face intense time poverty and fatigue. DO NOT overload the student.
2. Ensure mandatory breaks (at least 15-30 minutes) between work shifts, classes, and study sessions.
3. Suggest focused, achievable 20-45 minute study windows during realistic available gaps.
4. Prioritize tasks marked with "High" priority and approaching due dates.
5. Provide a realistic 7-day schedule suggestions with specific daily study sessions, quiz review times, and designated rest/sleep buffers.
6. Provide 2-3 practical, encouraging tips tailored to balancing their specific job and studies.`;

    const response = await generateContentWithRetry({
      preferredModel: PRIMARY_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overview: { type: Type.STRING, description: 'Summary of student weekly balance and free windows' },
            weeklyTips: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Actionable tips for working students to avoid burnout',
            },
            suggestedSessions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.STRING },
                  timeSlot: { type: Type.STRING },
                  category: {
                    type: Type.STRING,
                    description: 'study | quiz_review | break | assignment',
                  },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  durationMinutes: { type: Type.INTEGER },
                },
                required: ['day', 'timeSlot', 'category', 'title', 'durationMinutes'],
              },
            },
          },
          required: ['overview', 'weeklyTips', 'suggestedSessions'],
        },
      },
    });

    const text = cleanJsonString(response.text || '{}');
    const parsedData = JSON.parse(text);
    res.json({ success: true, plan: parsedData });
  } catch (error: any) {
    console.error('Error generating study plan:', error);
    res.status(500).json({
      error: 'Failed to generate study suggestions.',
      details: error.message,
    });
  }
});

// Vite middleware or production static serving
async function setupApp() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Study Buddy AI server running at http://0.0.0.0:${PORT}`);
  });
}

setupApp().catch((err) => {
  console.error('Failed to start server:', err);
});
