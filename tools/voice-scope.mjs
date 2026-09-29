/* Select lesson IDs explicitly requested for a voice-generation run. */
export function selectLessons(lessons, scope) {
  if (scope == null) return lessons;

  const ids = String(scope).split(',').map(id => id.trim());
  if (!ids.length || ids.some(id => !id)) {
    throw new Error('lesson scope must be a comma-separated list of lesson IDs');
  }

  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate lesson ID "${id}"`);
    seen.add(id);
  }

  const byId = new Map(lessons.map(lesson => [lesson.id, lesson]));
  const unknown = ids.filter(id => !byId.has(id));
  if (unknown.length) {
    throw new Error(`unknown lesson ID${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
  }
  return ids.map(id => byId.get(id));
}
