const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSetNumber, inventoryFromUrl, mappingsFromCsv, setPartsFromCsv, physicalFromBrickLink, upsertLocationMapping } = require('../server');
const { pieceDifficulty, buildStoragePlan } = require('../public/planner');

test('extrait le numéro depuis une URL Rebrickable', () => assert.equal(cleanSetNumber('https://rebrickable.com/sets/21309-1/nasa/#parts'), '21309-1'));
test('accepte directement un numéro de set', () => assert.equal(cleanSetNumber('75379-1'), '75379-1'));
test('rejette une valeur invalide', () => assert.throws(() => cleanSetNumber('Apollo'), /invalide/));
test('interprète la colonne Color Rebrickable comme un identifiant numérique', () => {
  const [part] = mappingsFromCsv('Part,Color,Quantity,Notes,Location,IsUsed\n3707,0,8,,C2,False\n');
  assert.deepEqual(part, { partNum: '3707', colorId: 0, colorName: '', location: 'C2' });
});
test('conserve la version inventory demandée dans le lien', () => {
  assert.equal(inventoryFromUrl('https://rebrickable.com/sets/21309-1/name/?_=123&inventory=1#parts'), 1);
  assert.equal(inventoryFromUrl('https://rebrickable.com/sets/21309-1/name/?inventory=2#parts'), 2);
});
test('lit un inventaire de set Rebrickable en excluant les pièces de rechange', () => {
  const parts = setPartsFromCsv('Part,Color,Quantity,Is Spare\n3001,0,4,False\n3002,1,1,True\n');
  assert.deepEqual(parts, [{ partNum: '3001', colorId: 0, quantity: 4, isSpare: false }]);
});
test('normalise le poids et les dimensions BrickLink sans utiliser le nom', () => {
  assert.deepEqual(physicalFromBrickLink({ no: '3001', name: 'nom volontairement faux', weight: '2.32', dim_x: '1.60', dim_y: '3.20', dim_z: '1.15' }, '3001'), {
    source: 'BrickLink', bricklinkNo: '3001', weightG: 2.32, dimensionsCm: [1.6, 3.2, 1.15], volumeCm3: 5.888
  });
});
test('remplace uniquement la case de la même pièce et couleur', () => {
  const mappings = [{ partNum: '3001', colorId: 0, colorName: '', location: 'A1' }, { partNum: '3001', colorId: 1, colorName: '', location: 'B1' }];
  assert.deepEqual(upsertLocationMapping(mappings, { partNum: '3001', colorId: 0, location: 'C2' }), [
    { partNum: '3001', colorId: 1, colorName: '', location: 'B1' },
    { partNum: '3001', colorId: 0, colorName: '', location: 'C2' }
  ]);
});
test('classe une grosse pièce mesurée avant une petite pièce sans mesure', () => {
  const large = { quantity: 2, color: { rgb: 'FF0000' }, physical: { weightG: 12, dimensionsCm: [4, 6, 2], volumeCm3: 48 } };
  const unknown = { quantity: 2, color: { rgb: '808080' } };
  assert.ok(pieceDifficulty(large).score < pieceDifficulty(unknown).score);
});
test('peut rouvrir une case lorsque les groupes physiques sont très éloignés', () => {
  const rows = [
    { location: 'A1', quantity: 10, part: { part_num: 'large' }, color: { id: 1, rgb: 'FF0000' }, physical: { weightG: 25, dimensionsCm: [5, 7, 3], volumeCm3: 105 } },
    { location: 'A1', quantity: 1, part: { part_num: 'tiny' }, color: { id: 1, rgb: '808080' }, physical: { weightG: 0.05, dimensionsCm: [0.2, 0.2, 0.1], volumeCm3: 0.004 } }
  ];
  const plan = buildStoragePlan(rows);
  assert.equal(plan.visits.length, 2);
  assert.deepEqual(plan.visits.map(visit => visit.visitIndex), [1, 2]);
});
