const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanSetNumber, inventoryFromUrl, mappingsFromCsv, setPartsFromCsv } = require('../server');

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
