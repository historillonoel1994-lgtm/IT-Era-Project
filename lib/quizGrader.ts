/**
 * Shared deterministic quiz answer validator used by BOTH:
 * - Frontend immediate feedback (GenerateQuizView.tsx)
 * - Backend secure final score verification (POST /api/quiz/grade)
 *
 * Strictly rejects blank, punctuation-only, unrelated, or partial-substring guesses
 * for fill-in-the-blank and identification questions while ignoring harmless
 * casing, extra spaces, and trailing punctuation.
 */

export interface GradableQuestion {
  id?: string;
  type: string;
  question?: string;
  options?: string[];
  correctAnswer: string;
  acceptedAnswers?: string[];
}

export interface GradeResult {
  isCorrect: boolean;
  normalizedUserAnswer: string;
  expectedAnswer: string;
  acceptedNormalized: string[];
  reason: 'exact_match' | 'accepted_alternative' | 'keyword_match' | 'blank' | 'mismatch';
}

const SHORT_ANSWER_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'onto', 'upon',
  'about', 'above', 'after', 'again', 'against', 'also', 'because', 'been',
  'before', 'being', 'between', 'both', 'could', 'does', 'doing', 'down',
  'during', 'each', 'have', 'having', 'here', 'just', 'more', 'most', 'only',
  'other', 'over', 'same', 'should', 'some', 'such', 'than', 'their', 'them',
  'then', 'there', 'these', 'they', 'through', 'under', 'very', 'what', 'when',
  'where', 'which', 'while', 'will', 'would', 'your', 'refers', 'means',
]);

/**
 * Normalizes a student answer or canonical answer for fair, strict comparison:
 * - Lowercases
 * - Normalizes unicode dashes/quotes
 * - Strips harmless wrapping/trailing punctuation
 * - Collapses repeated whitespace to single spaces
 */
export function normalizeAnswerText(raw?: string | null): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/^[\s"'`([{.,;:!?-]+|[\s"'`)\]}.,;:!?-]+$/g, '')
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts explicitly valid canonical variants from a question's correctAnswer and
 * acceptedAnswers array (e.g., "Gross Domestic Product (GDP)" accepts both
 * "gross domestic product" and "gdp", and "A / B" accepts "a" or "b").
 * Does NOT invent fuzzy or partial-word matches.
 */
export function buildAcceptedAnswers(
  correctAnswer: string,
  explicitAlternatives?: string[]
): string[] {
  const candidates = new Set<string>();

  const addCandidate = (val?: string | null) => {
    const norm = normalizeAnswerText(val);
    if (norm.length > 0) {
      candidates.add(norm);
    }
  };

  addCandidate(correctAnswer);

  if (Array.isArray(explicitAlternatives)) {
    for (const alt of explicitAlternatives) {
      addCandidate(alt);
    }
  }

  // Handle explicit parenthetical alias like "Gross Domestic Product (GDP)"
  const parenMatch = typeof correctAnswer === 'string'
    ? correctAnswer.match(/^(.+?)\s*\(([^()]{2,})\)\s*$/)
    : null;
  if (parenMatch) {
    addCandidate(parenMatch[1]);
    addCandidate(parenMatch[2]);
  }

  // Handle explicit slash alternatives like "True / False" or "Capitalism / Free Market"
  if (typeof correctAnswer === 'string' && /\s+\/\s+/.test(correctAnswer)) {
    for (const part of correctAnswer.split(/\s+\/\s+/)) {
      addCandidate(part);
    }
  }

  return Array.from(candidates);
}

/**
 * Strips leading English articles ("a ", "an ", "the ") ONLY for non-trivial
 * multi-word or noun-phrase comparisons when the remaining core term is >= 2 chars.
 */
function stripLeadingArticle(normalized: string): string {
  const stripped = normalized.replace(/^(a|an|the)\s+/, '').trim();
  return stripped.length >= 2 ? stripped : normalized;
}

/**
 * Grades a single student answer against a question deterministically.
 */
export function gradeQuizAnswer(
  question: GradableQuestion,
  rawUserAnswer?: string | null
): GradeResult {
  const expectedAnswer = (question.correctAnswer || '').trim();
  const normalizedUser = normalizeAnswerText(rawUserAnswer);
  const accepted = buildAcceptedAnswers(expectedAnswer, question.acceptedAnswers);

  if (!normalizedUser) {
    return {
      isCorrect: false,
      normalizedUserAnswer: '',
      expectedAnswer,
      acceptedNormalized: accepted,
      reason: 'blank',
    };
  }

  const qType = (question.type || 'multiple_choice').toLowerCase();

  // 1. Multiple Choice & True/False: exact normalized match against correctAnswer
  if (qType === 'multiple_choice' || qType === 'true_false') {
    const normExpected = normalizeAnswerText(expectedAnswer);
    const isExact = normalizedUser === normExpected;
    return {
      isCorrect: isExact,
      normalizedUserAnswer: normalizedUser,
      expectedAnswer,
      acceptedNormalized: [normExpected].filter(Boolean),
      reason: isExact ? 'exact_match' : 'mismatch',
    };
  }

  // 2. Fill-in-the-Blank & Identification: strict equality against correctAnswer or explicit acceptedAnswers
  //    NO substring matching (prevents single letters or wrong short strings from passing!)
  if (qType === 'fill_in_the_blank' || qType === 'identification') {
    const userNoArticle = stripLeadingArticle(normalizedUser);
    const primaryNorm = normalizeAnswerText(expectedAnswer);

    if (
      normalizedUser === primaryNorm ||
      (userNoArticle === stripLeadingArticle(primaryNorm) && userNoArticle.length >= 2)
    ) {
      return {
        isCorrect: true,
        normalizedUserAnswer: normalizedUser,
        expectedAnswer,
        acceptedNormalized: accepted,
        reason: 'exact_match',
      };
    }

    for (const alt of accepted) {
      if (
        normalizedUser === alt ||
        (userNoArticle === stripLeadingArticle(alt) && userNoArticle.length >= 2)
      ) {
        return {
          isCorrect: true,
          normalizedUserAnswer: normalizedUser,
          expectedAnswer,
          acceptedNormalized: accepted,
          reason: 'accepted_alternative',
        };
      }
    }

    return {
      isCorrect: false,
      normalizedUserAnswer: normalizedUser,
      expectedAnswer,
      acceptedNormalized: accepted,
      reason: 'mismatch',
    };
  }

  // 3. Short Answer / Scenario / Concept Contrasts (when free-text without options):
  //    Exact match against accepted answers OR strict content-keyword coverage (>= 65%)
  if (accepted.includes(normalizedUser)) {
    return {
      isCorrect: true,
      normalizedUserAnswer: normalizedUser,
      expectedAnswer,
      acceptedNormalized: accepted,
      reason: 'exact_match',
    };
  }

  const expectedTokens = Array.from(
    new Set(
      normalizeAnswerText(expectedAnswer)
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !SHORT_ANSWER_STOPWORDS.has(w))
    )
  );
  const userTokens = new Set(
    normalizedUser
      .split(/\s+/)
      .filter((w) => w.length >= 3)
  );

  // Reject answers that are too short compared to the expected short answer
  if (expectedTokens.length === 0 || userTokens.size === 0) {
    return {
      isCorrect: false,
      normalizedUserAnswer: normalizedUser,
      expectedAnswer,
      acceptedNormalized: accepted,
      reason: 'mismatch',
    };
  }

  // Check negation contradiction (e.g., student says "not X" when expected does not negate)
  const expectedHasNegation = /\b(not|never|no|false|incorrect|cannot|without)\b/.test(
    normalizeAnswerText(expectedAnswer)
  );
  const userHasNegation = /\b(not|never|no|false|incorrect|cannot|without)\b/.test(normalizedUser);
  if (expectedHasNegation !== userHasNegation) {
    return {
      isCorrect: false,
      normalizedUserAnswer: normalizedUser,
      expectedAnswer,
      acceptedNormalized: accepted,
      reason: 'mismatch',
    };
  }

  const matchedCount = expectedTokens.filter((tok) => userTokens.has(tok)).length;
  const requiredCount = Math.max(2, Math.ceil(expectedTokens.length * 0.65));
  const passed =
    expectedTokens.length === 1
      ? matchedCount === 1 && normalizedUser.length >= expectedTokens[0].length
      : matchedCount >= Math.min(requiredCount, expectedTokens.length);

  return {
    isCorrect: passed,
    normalizedUserAnswer: normalizedUser,
    expectedAnswer,
    acceptedNormalized: accepted,
    reason: passed ? 'keyword_match' : 'mismatch',
  };
}
