// Loads and validates the question bank from questions/*.json.
import fs from 'node:fs';
import path from 'node:path';

const QUESTIONS_DIR = path.join(process.cwd(), 'questions');
let cache;

export function validateQuestion(q, where) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) return [`${where}: not an object`];
  const errors = [];
  if (typeof q.id !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(q.id)) {
    errors.push(`${where}: id must be 1-80 letters, digits, dots, dashes or underscores`);
  }
  if (typeof q.question !== 'string' || !q.question.trim()) errors.push(`${where}: question is missing`);
  if (
    !Array.isArray(q.options) ||
    q.options.length < 2 ||
    q.options.length > 8 ||
    q.options.some((o) => typeof o !== 'string' || !o.trim())
  ) {
    errors.push(`${where}: options must be a list of 2-8 non-empty texts`);
  } else if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length) {
    errors.push(`${where}: answer must be the 0-based position of the correct option`);
  }
  for (const field of ['explanation', 'source', 'topic', 'code']) {
    if (q[field] !== undefined && typeof q[field] !== 'string') errors.push(`${where}: ${field} must be text`);
  }
  if (q.shuffle !== undefined && typeof q.shuffle !== 'boolean') errors.push(`${where}: shuffle must be true or false`);
  if (q.coverage !== undefined && q.coverage !== 'slides' && q.coverage !== 'pensum') {
    errors.push(`${where}: coverage must be "slides" or "pensum"`);
  }
  return errors;
}

export function loadBank(dir = QUESTIONS_DIR) {
  const list = [];
  const byId = new Map();
  const errors = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  for (const file of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      errors.push(`${file}: invalid JSON (${e.message})`);
      continue;
    }
    if (!Array.isArray(data)) {
      errors.push(`${file}: must contain a JSON list of questions`);
      continue;
    }
    data.forEach((q, i) => {
      const where = `${file} #${i + 1}${q && typeof q.id === 'string' ? ` (${q.id})` : ''}`;
      const problems = validateQuestion(q, where);
      if (problems.length) return errors.push(...problems);
      if (byId.has(q.id)) return errors.push(`${where}: duplicate id`);
      const clean = {
        id: q.id,
        question: q.question.trim(),
        options: q.options.map((o) => o.trim()),
        answer: q.answer,
        explanation: (q.explanation || '').trim(),
        source: (q.source || '').trim(),
        topic: (q.topic || '').trim(),
        code: (q.code || '').replace(/\s+$/, '').replace(/^\n+/, ''),
        shuffle: q.shuffle !== false,
        pensum: q.coverage === 'pensum',
        file,
      };
      byId.set(clean.id, clean);
      list.push(clean);
    });
  }
  return { list, byId, errors };
}

// Cached bank for the running server. Invalid questions are skipped (the build check fails on them).
export function bank() {
  if (!cache) {
    cache = loadBank();
    if (cache.errors.length) console.error(`Question bank problems:\n${cache.errors.join('\n')}`);
  }
  return cache;
}
