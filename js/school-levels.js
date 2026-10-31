/* What a Kenyan school teaches, by school type (CBC; the old 8-4-4 Form 1-4 can be added).
 * Used by the Fee Structure Manager and anywhere a class list is needed. */
(() => {
  'use strict';
  const range = (prefix, a, b) => Array.from({ length: b - a + 1 }, (_, i) => prefix + ' ' + (a + i));
  const SECTIONS = {
    pre:    { name: 'Pre-Primary',    grades: ['PP1', 'PP2'] },
    lower:  { name: 'Lower Primary',  grades: range('Grade', 1, 3) },
    upper:  { name: 'Upper Primary',  grades: range('Grade', 4, 6) },
    junior: { name: 'Junior School',  grades: range('Grade', 7, 9) },
    senior: { name: 'Senior School',  grades: range('Grade', 10, 12) },
    legacy: { name: 'Secondary (8-4-4)', grades: range('Form', 1, 4) }
  };
  // which sections a school of each type starts with, and which it may add
  const TYPES = {
    'Primary Only':        { label: 'Primary school',      start: ['pre', 'lower', 'upper'],                      optional: ['junior'] },
    'Secondary Only':      { label: 'Secondary school',    start: ['junior', 'senior'],                           optional: ['legacy'] },
    'Primary & Secondary': { label: 'Primary & Secondary', start: ['pre', 'lower', 'upper', 'junior', 'senior'],  optional: ['legacy'] }
  };
  // Typical fee items per section. Amounts are never guessed: the school types its own.
  const ITEMS = {
    primary: [
      ['Tuition', 'Tuition', false], ['Lunch Programme', 'Lunch / Meals', false], ['Activity Fee', 'Activity & Co-curricular', false],
      ['Assessment / Exams', 'Exams', false], ['Transport', 'Transport', false], ['Boarding', 'Boarding', true]
    ],
    secondary: [
      ['Tuition', 'Tuition', false], ['Boarding', 'Boarding', true], ['Laboratory / Science', 'Lab', false], ['ICT / Computer', 'ICT', false],
      ['Exams', 'Exams', false], ['Activity Fee', 'Activity & Co-curricular', false], ['Development / Building', 'Development', false],
      ['Medical / Insurance', 'Medical', false], ['Transport', 'Transport', false], ['Lunch Programme', 'Lunch / Meals', false]
    ]
  };
  const CATEGORIES = ['Tuition', 'Boarding', 'Lunch / Meals', 'Transport', 'Activity & Co-curricular', 'Exams', 'Lab', 'ICT', 'Development', 'Medical', 'Uniform & Books', 'Other'];
  const kindOf = (key) => (['pre', 'lower', 'upper'].includes(key) ? 'primary' : 'secondary');
  // what the grade list of a section should look like in the structure's data format
  const buildSection = (key, withItems) => ({
    key, name: SECTIONS[key].name,
    grades: SECTIONS[key].grades.map((name) => ({ name, fees: withItems ? starterFees(key) : [] }))
  });
  const starterFees = (key) => {
    const base = ITEMS[kindOf(key)].filter(([n]) => ['Tuition', 'Lunch Programme', 'Activity Fee'].includes(n) || (key !== 'pre' && n === 'Boarding'));
    return base.map(([name, category, boarderOnly]) => ({ name, category, boarderOnly, amounts: [0, 0, 0] }));
  };
  const typeOf = (level) => TYPES[level] || TYPES['Primary & Secondary'];
  const initialLevels = (level, withItems = true) => typeOf(level).start.map((k) => { const s = buildSection(k, withItems); return { name: s.name, grades: s.grades }; });
  window.FFLevels = { SECTIONS, TYPES, ITEMS, CATEGORIES, kindOf, typeOf, initialLevels, buildSection, itemsFor: (key) => ITEMS[kindOf(key)] };
})();
