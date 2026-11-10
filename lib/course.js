// Everything specific to one course lives in course.json at the project root. This module loads
// and checks it once; the front end gets the public parts through GET /api/config.
//
// Lectures are listed in order, even before they have questions. A lecture counts as "ready" once
// it has questions of its own; until then it shows as "Coming soon", with any sample questions
// (from samplesFile) playable. Question topics must match the lecture names exactly.
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'course.json');

function load() {
  let c;
  try {
    c = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    throw new Error(`course.json could not be read: ${e.message}`);
  }
  const errors = [];
  for (const key of ['appName', 'code', 'name']) {
    if (typeof c[key] !== 'string' || !c[key].trim()) errors.push(`course.json: "${key}" must be a non-empty text`);
  }
  if (!Array.isArray(c.lectures) || !c.lectures.length || c.lectures.some((l) => typeof l !== 'string' || !l.trim())) {
    errors.push('course.json: "lectures" must be a list of lecture names');
  } else if (new Set(c.lectures).size !== c.lectures.length) {
    errors.push('course.json: lecture names must be unique');
  }
  const info = c.sourceInfo || {};
  for (const [kind, list] of [['books', info.books], ['documents', info.documents]]) {
    for (const [i, item] of (list || []).entries()) {
      for (const re of [item.match, item.also, item.unless].filter((x) => x !== undefined)) {
        try {
          new RegExp(re, 'i');
        } catch {
          errors.push(`course.json: sourceInfo.${kind}[${i}] has an invalid pattern "${re}"`);
        }
      }
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return c;
}

export const COURSE = load();
export const LECTURES = COURSE.lectures;
// Questions from this file are samples (e.g. from the lecturer) and don't make a lecture "ready".
export const SAMPLES_FILE = COURSE.samplesFile || null;

// What the browser needs. Only public, non-secret course settings belong in course.json.
export function publicCourse() {
  const d = COURSE.directory || {};
  return {
    appName: COURSE.appName,
    code: COURSE.code,
    name: COURSE.name,
    tagline: COURSE.tagline || 'Multiple-choice practice for the exam',
    samplesOwner: typeof COURSE.samplesOwner === 'string' ? COURSE.samplesOwner : '',
    sourceInfo: COURSE.sourceInfo || {},
    directory: Boolean(d.enabled && d.url),
  };
}
