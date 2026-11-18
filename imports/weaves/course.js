/* Weaves course order and save migration. Original board identities never change. By Luke Steuber. */
(function(root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make(require('./boards.js'), require('./course-data.js'));
  else root.WeaveCourse = make(root.WeaveBoards, root.WeaveCourseData);
})(typeof globalThis === 'object' ? globalThis : this, function(legacy, data) {
  'use strict';
  const all = legacy.concat(data.extra), main = data.order.map(id => all.find(b => b.id === id));
  if (main.some(b => !b) || new Set(data.order).size !== data.order.length) throw Error('Invalid Weaves course');
  const more = legacy.filter(b => !data.order.includes(b.id));
  const index = id => data.order.indexOf(id);
  const openedBy = done => Math.min(main.length - 1, Math.max(0, ...[...done].map(id => index(id) + 1)));
  function migrate(saved, reached, current, done) {
    let open = saved?.course === 1 ? saved.courseReached : 0;
    // Previously opened original boards stay open, including the small-course
    // finale. New players do not inherit the optional library's open state.
    if (saved && saved.course === undefined) {
      for (const [i, b] of main.entries()) { const old = legacy.indexOf(b); if (old >= 0 && old <= reached) open = Math.max(open, i); }
    }
    return Math.min(main.length - 1, Math.max(open, openedBy(done), index(current)));
  }
  return { all, main, more, index, openedBy, migrate, legacyCount: legacy.length };
});
