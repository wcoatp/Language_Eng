import { kvGet, kvUpdate } from './db.js';
import { progressFor, recordLearning } from './learning.js';

export async function getLearningProgress(lesson) {
  return progressFor(lesson, await kvGet('lessonLearningProgress', {}));
}

export async function saveLearning(lesson, kind, id, value) {
  const all = await kvUpdate('lessonLearningProgress', {}, stored => recordLearning(stored, lesson, kind, id, value));
  return progressFor(lesson, all);
}
