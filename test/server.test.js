const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSetNumber, cleanModel, inventoryFromUrl, mappingsFromCsv, setPartsFromCsv, withoutSpares, combineLDrawBounds, physicalFromLDrawBounds, upsertLocationMapping, occupiedCases, storageCaseUniverse, inferredEmptyCases, moveStorageMappings, consolidateMoveHistory, completedWithChange } = require('../server');
const { pieceDifficulty, shapeKey, buildStoragePlan } = require('../public/planner');

test('extrait le numéro depuis une URL Rebrickable', () => assert.equal(cleanSetNumber('https://rebrickable.com/sets/21309-1/nasa/#parts'), '21309-1'));
test('accepte directement un numéro de set', () => assert.equal(cleanSetNumber('75379-1'), '75379-1'));
test('rejette une valeur invalide', () => assert.throws(() => cleanSetNumber('Apollo'), /invalide/));
test('reconnaît un lien de MOC avec son slug', () => assert.deepEqual(cleanModel('https://rebrickable.com/mocs/MOC-261470/Wurger%20Bricks/1989-bat-mobile/#details'), { type: 'moc', id: 'MOC-261470' }));
test('interprète la colonne Color Rebrickable comme un identifiant numérique', () => {
  const [part] = mappingsFromCsv('Part,Color,Quantity,Notes,Location,IsUsed\n3707,0,8,,C2,False\n');
  assert.deepEqual(part, { partNum: '3707', colorId: 0, colorName: '', quantity: 8, location: 'C2' });
});
test('regroupe toutes les références par case occupée', () => {
  const cases = occupiedCases([
    { partNum: '3001', colorId: 1, location: 'C2' },
    { partNum: '3001', colorId: 2, location: 'C2' },
    { partNum: '3002', colorId: 1, location: 'C2' },
    { partNum: '3003', colorId: 1, location: 'Sans case' },
    { partNum: '3004', colorId: 1, location: 'A10' }
  ]);
  assert.deepEqual(cases, [
    { location: 'A10', referenceCount: 1, partCount: 1, colorCount: 1 },
    { location: 'C2', referenceCount: 3, partCount: 2, colorCount: 2 }
  ]);
});
test('déplace plusieurs références et détecte une case vidée', () => {
  const result = moveStorageMappings([
    { partNum: '3001', colorId: 1, location: 'C2' },
    { partNum: '3002', colorId: 2, location: 'C2' },
    { partNum: '3003', colorId: 3, location: 'D4' }
  ], { fromLocation: 'C2', toLocation: 'E1', items: [{ partNum: '3001', colorId: 1 }, { partNum: '3002', colorId: 2 }] });
  assert.equal(result.sourceEmpty, true);
  assert.deepEqual(result.mappings.map(item => item.location), ['E1', 'E1', 'D4']);
  assert.deepEqual(result.moved.map(item => [item.fromLocation, item.toLocation]), [['C2', 'E1'], ['C2', 'E1']]);
});
test('déduit les cases libres dans les séries de rangement', () => {
  const universe = storageCaseUniverse();
  assert.equal(universe.length, 291);
  assert.deepEqual(universe.slice(0, 5), ['1', '2', '3', 'A1', 'A2']);
  assert.deepEqual(universe.slice(-3), ['AF7', 'AF8', 'AF9']);
  const occupied = universe.filter(location => !['2', 'A2', 'AF9'].includes(location)).map((location, index) => ({ partNum: String(index), colorId: 1, location }));
  assert.deepEqual(inferredEmptyCases(occupied).map(item => item.location), ['2', 'A2', 'AF9']);
});
test('conserve uniquement le trajet entre la première et la dernière case', () => {
  const first = consolidateMoveHistory([], [{ partNum: '3001', colorId: 1, fromLocation: 'A1', toLocation: 'B1' }]);
  const second = consolidateMoveHistory(first, [{ partNum: '3001', colorId: 1, fromLocation: 'B1', toLocation: 'C1' }]);
  assert.equal(second.length, 1);
  assert.equal(second[0].originalLocation, 'A1');
  assert.equal(second[0].currentLocation, 'C1');
  assert.deepEqual(consolidateMoveHistory(second, [{ partNum: '3001', colorId: 1, fromLocation: 'C1', toLocation: 'A1' }]), []);
});
test('conserve la version inventory demandée dans le lien', () => {
  assert.equal(inventoryFromUrl('https://rebrickable.com/sets/21309-1/name/?_=123&inventory=1#parts'), 1);
  assert.equal(inventoryFromUrl('https://rebrickable.com/sets/21309-1/name/?inventory=2#parts'), 2);
});
test('lit un inventaire de set Rebrickable en excluant les pièces de rechange', () => {
  const parts = setPartsFromCsv('Part,Color,Quantity,Is Spare\n3001,0,4,False\n3002,1,1,True\n');
  assert.deepEqual(parts, [{ partNum: '3001', colorId: 0, quantity: 4, isSpare: false }]);
});
test('exclut aussi les spares renvoyés par une API malgré le paramètre inc_spares', () => {
  assert.deepEqual(withoutSpares([{ id: 1, is_spare: true }, { id: 2, is_spare: false }, { id: 3, isSpare: true }]), [{ id: 2, is_spare: false }]);
});
test('calcule les dimensions depuis les sommets LDraw sans utiliser le nom', () => {
  const bounds = combineLDrawBounds('3 16 -20 -12 -10 20 -12 -10 20 12 10\n4 16 -20 -12 -10 20 12 10 -20 12 10 -20 12 -10\n');
  assert.deepEqual(physicalFromLDrawBounds(bounds, '3001'), {
    source: 'LDraw', ldrawNo: '3001', dimensionsCm: [1.6, 0.96, 0.8], volumeCm3: 1.229
  });
});
test('applique la matrice des sous-pièces LDraw à la boîte englobante', () => {
  const child = { min: [-1, -2, -3], max: [1, 2, 3] };
  const bounds = combineLDrawBounds('1 16 10 20 30 1 0 0 0 1 0 0 0 1 child.dat\n', { 'child.dat': child });
  assert.deepEqual(bounds, { min: [9, 18, 27], max: [11, 22, 33] });
});
test('ignore les points de contrôle des lignes conditionnelles LDraw', () => {
  const bounds = combineLDrawBounds('5 24 -1 -2 -3 1 2 3 -100 -100 -100 100 100 100\n');
  assert.deepEqual(bounds, { min: [-1, -2, -3], max: [1, 2, 3] });
});
test('remplace uniquement la case de la même pièce et couleur', () => {
  const mappings = [{ partNum: '3001', colorId: 0, colorName: '', location: 'A1' }, { partNum: '3001', colorId: 1, colorName: '', location: 'B1' }];
  assert.deepEqual(upsertLocationMapping(mappings, { partNum: '3001', colorId: 0, location: 'C2' }), [
    { partNum: '3001', colorId: 1, colorName: '', location: 'B1' },
    { partNum: '3001', colorId: 0, colorName: '', location: 'C2' }
  ]);
});
test('classe une grosse pièce mesurée avant une petite pièce sans mesure', () => {
  const large = { quantity: 2, color: { rgb: 'FF0000' }, physical: { dimensionsCm: [4, 6, 2], volumeCm3: 48 } };
  const unknown = { quantity: 2, color: { rgb: '808080' } };
  assert.ok(pieceDifficulty(large).score < pieceDifficulty(unknown).score);
});
test('privilégie une grosse silhouette unique avant des pièces plates très proches', () => {
  const rows = [
    { location: 'A', quantity: 1, part: { part_num: 'window', part_cat_id: 1 }, color: { id: 1, rgb: '808080' }, physical: { dimensionsCm: [1.2, 5, 7], volumeCm3: 42 } },
    { location: 'B', quantity: 2, part: { part_num: 'plate-a', part_cat_id: 2 }, color: { id: 1, rgb: '808080' }, physical: { dimensionsCm: [.25, 1.6, 2.4], volumeCm3: .96 } },
    { location: 'C', quantity: 2, part: { part_num: 'plate-b', part_cat_id: 2 }, color: { id: 1, rgb: '808080' }, physical: { dimensionsCm: [.25, 1.6, 2.5], volumeCm3: 1 } }
  ];
  const plan = buildStoragePlan(rows);
  assert.equal(plan.visits[0].location, 'A');
});
test('peut rouvrir une case lorsque les groupes physiques sont très éloignés', () => {
  const rows = [
    { location: 'A1', quantity: 10, part: { part_num: 'large' }, color: { id: 1, rgb: 'FF0000' }, physical: { dimensionsCm: [5, 7, 3], volumeCm3: 105 } },
    { location: 'A1', quantity: 1, part: { part_num: 'tiny' }, color: { id: 1, rgb: '808080' }, physical: { dimensionsCm: [0.2, 0.2, 0.1], volumeCm3: 0.004 } }
  ];
  const plan = buildStoragePlan(rows);
  assert.equal(plan.visits.length, 2);
  assert.deepEqual(plan.visits.map(visit => visit.visitIndex), [1, 2]);
});
test('reconnaît la forme de base des pièces imprimées', () => {
  assert.equal(shapeKey({ part: { part_num: '3069bpr0205', print_of: '3069b' } }), '3069b');
});
test('indique quand une étape termine une forme, une couleur ou les deux', () => {
  const physical = { dimensionsCm: [1, 1, 1], volumeCm3: 1 };
  const plan = buildStoragePlan([
    { location: 'A1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 1, name: 'Rouge' }, physical },
    { location: 'A1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 2, name: 'Bleu' }, physical },
    { location: 'A1', quantity: 1, part: { part_num: 'shape-b' }, color: { id: 1, name: 'Rouge' }, physical }
  ]);
  const [redA, blueA, redB] = plan.rows;
  assert.deepEqual(redA.coordination, { shapeComplete: true, colorComplete: true, both: true, colorCount: 2, shapeCount: 2 });
  assert.deepEqual(blueA.coordination, { shapeComplete: true, colorComplete: false, both: false, colorCount: 2, shapeCount: 1 });
  assert.deepEqual(redB.coordination, { shapeComplete: false, colorComplete: true, both: false, colorCount: 1, shapeCount: 2 });
});
test('ne signale pas une forme répartie sur plusieurs étapes', () => {
  const physical = { dimensionsCm: [1, 1, 1], volumeCm3: 1 };
  const plan = buildStoragePlan([
    { location: 'A1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 1 }, physical },
    { location: 'B1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 2 }, physical }
  ]);
  assert.equal(plan.rows[0].coordination.shapeComplete, false);
  assert.equal(plan.rows[1].coordination.shapeComplete, false);
});
test('considère deux passages dans la même case comme deux étapes', () => {
  const plan = buildStoragePlan([
    { location: 'A1', quantity: 20, part: { part_num: 'shape-a' }, color: { id: 1, rgb: 'FF0000' }, physical: { dimensionsCm: [8, 8, 4], volumeCm3: 256 } },
    { location: 'A1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 2, rgb: '808080' }, physical: { dimensionsCm: [0.1, 0.1, 0.1], volumeCm3: 0.001 } }
  ]);
  assert.equal(plan.visits.length, 2);
  assert.equal(plan.rows[0].coordination.shapeComplete, false);
});
test('une pièce sans case invalide l’indicateur de sa forme', () => {
  const physical = { dimensionsCm: [1, 1, 1], volumeCm3: 1 };
  const plan = buildStoragePlan([
    { location: 'A1', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 1 }, physical },
    { location: '', quantity: 1, part: { part_num: 'shape-a' }, color: { id: 2 }, physical }
  ]);
  assert.equal(plan.rows[0].coordination.shapeComplete, false);
});
test('ajoute et retire une référence de la progression sans doublon', () => {
  assert.deepEqual(completedWithChange(['3001|1'], '3002|2', true), ['3001|1', '3002|2']);
  assert.deepEqual(completedWithChange(['3001|1', '3001|1'], '3001|1', false), []);
});
