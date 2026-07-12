(function exposePlanner(root, factory) {
  const planner = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = planner;
  else root.LegoPlanner = planner;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlanner() {
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function rgbProfile(rgb) {
    const value = String(rgb || '').replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return null;
    const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
    const maximum = Math.max(...channels), minimum = Math.min(...channels);
    return { saturation: maximum === 0 ? 0 : (maximum - minimum) / maximum, lightness: (maximum + minimum) / 2 };
  }

  function physicalProfile(part) {
    const dimensions = (part.physical?.dimensionsCm || []).map(Number).filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    const complete = dimensions.length === 3;
    const weightG = Number(part.physical?.weightG) > 0 ? Number(part.physical.weightG) : null;
    const volumeCm3 = Number(part.physical?.volumeCm3) > 0
      ? Number(part.physical.volumeCm3)
      : complete ? dimensions.reduce((product, value) => product * value, 1) : null;
    return {
      available: complete,
      dimensions,
      weightG,
      volumeCm3,
      longestCm: dimensions.at(-1) || null,
      slenderness: complete ? dimensions[2] / dimensions[0] : null,
      flatness: complete ? dimensions[0] / dimensions[2] : null
    };
  }

  function dimensionsClose(left, right) {
    if (!left.available || !right.available) return false;
    return left.dimensions.every((value, index) => Math.abs(value - right.dimensions[index]) <= Math.max(0.18, Math.max(value, right.dimensions[index]) * 0.22));
  }

  function planningContext(rows) {
    const profiles = rows.map(physicalProfile);
    const categories = new Map();
    rows.forEach(row => {
      const category = row.part?.part_cat_id;
      if (category != null) categories.set(category, (categories.get(category) || 0) + 1);
    });
    return { rows, profiles, categories };
  }

  function pieceDifficulty(part, context = null, rowIndex = -1) {
    const physical = physicalProfile(part);
    const quantity = Math.max(1, Number(part.quantity) || 1);
    let score = 78;
    const reasons = [];
    if (physical.available) {
      if (physical.volumeCm3 != null) score -= clamp(Math.log1p(physical.volumeCm3) * 11, 0, 36);
      if (physical.longestCm != null) score -= clamp(Math.log1p(physical.longestCm) * 5, 0, 14);
      if (physical.weightG != null) score -= clamp(Math.log1p(physical.weightG) * 2, 0, 8);
      if (physical.slenderness >= 5) { score += 7; reasons.push('longue et fine, facile à confondre'); }
      else if (physical.flatness != null && physical.flatness <= 0.16) { score += 8; reasons.push('très plate, facile à confondre'); }
      else if ((physical.volumeCm3 || 0) >= 8) reasons.push('gros volume bien visible');
      else if ((physical.volumeCm3 || Infinity) < 0.5) reasons.push('très petite pièce');
      else reasons.push('gabarit LDraw connu');
      if (context) {
        const similar = context.profiles.filter((candidate, index) => index !== rowIndex && dimensionsClose(physical, candidate)).length;
        if (similar) { score += clamp(Math.log2(similar + 1) * 8, 0, 22); reasons.push(`${similar} gabarit${similar > 1 ? 's' : ''} proche${similar > 1 ? 's' : ''} restant${similar > 1 ? 's' : ''}`); }
        else { score -= 7; reasons.push('silhouette unique dans le vrac restant'); }
      }
    } else {
      score += 10;
      reasons.push('géométrie LDraw manquante');
    }
    if (context && part.part?.part_cat_id != null) {
      const categoryCount = context.categories.get(part.part.part_cat_id) || 1;
      if (categoryCount > 3) { score += clamp(Math.log2(categoryCount) * 3, 0, 13); reasons.push('famille de pièces encore nombreuse'); }
    }
    const color = rgbProfile(part.color?.rgb);
    if (color) {
      const colorBonus = color.saturation * 10 + Math.abs(color.lightness - 0.5) * 4;
      score -= colorBonus;
      if (color.saturation >= 0.55) reasons.push('couleur contrastée');
    }
    const quantityCost = clamp(Math.log2(quantity + 1) * 1.5, 0, 8);
    score += quantityCost;
    if (quantity >= 8) reasons.push('plusieurs exemplaires à repérer');
    score = Math.round(clamp(score, 5, 99));
    return {
      score,
      level: score < 36 ? 'Facile' : score < 61 ? 'Intermédiaire' : 'Minutieux',
      reasons,
      physical
    };
  }

  const weightedDifficulty = rows => {
    const weights = rows.map(row => Math.max(1, Math.log2((Number(row.quantity) || 1) + 1)));
    return rows.reduce((total, row, index) => total + row.sorting.score * weights[index], 0) / weights.reduce((a, b) => a + b, 0);
  };

  function visitsForCase(location, rows) {
    const ordered = rows.slice().sort((a, b) => a.sorting.score - b.sorting.score);
    const reopeningCost = 14;
    const cuts = [];
    for (let index = 1; index < ordered.length; index += 1) {
      const gap = ordered[index].sorting.score - ordered[index - 1].sorting.score;
      if (gap > reopeningCost + 4) cuts.push({ index, gap });
    }
    const selected = cuts.sort((a, b) => b.gap - a.gap).slice(0, 2).sort((a, b) => a.index - b.index);
    const groups = [];
    let start = 0;
    selected.forEach(cut => { groups.push(ordered.slice(start, cut.index)); start = cut.index; });
    groups.push(ordered.slice(start));
    const largestGap = selected[0]?.gap || 0;
    return groups.map((parts, index) => ({
      location,
      parts,
      score: Math.round(Math.max(...parts.map(row => row.sorting.score)) * 0.82 + weightedDifficulty(parts) * 0.18),
      split: groups.length > 1,
      visitIndex: index + 1,
      visitCount: groups.length,
      splitReason: groups.length > 1 ? `Écart de difficulté ${Math.round(largestGap)} > coût de réouverture ${reopeningCost}` : ''
    }));
  }

  function shapeKey(row) {
    const part = row.part || {};
    const value = part.print_of?.part_num || part.print_of || part.mold_part_num?.part_num || part.mold_part_num || part.part_num || '';
    return String(value);
  }

  function addCoordinationIndicators(rows, visits) {
    const stepById = new Map();
    visits.forEach(visit => visit.parts.forEach(row => stepById.set(row.planId, visit.step)));
    const shapes = new Map(), colors = new Map();
    rows.forEach(row => {
      const shape = shapeKey(row);
      const color = row.color?.id != null ? `id:${row.color.id}` : `unknown:${row.planId}`;
      shapes.set(shape, [...(shapes.get(shape) || []), row]);
      colors.set(color, [...(colors.get(color) || []), row]);
    });
    const allAtSameStep = group => {
      const steps = new Set(group.map(row => stepById.get(row.planId)));
      return !steps.has(undefined) && steps.size === 1;
    };
    rows.forEach(row => {
      const shapeGroup = shapes.get(shapeKey(row)) || [];
      const colorGroup = colors.get(row.color?.id != null ? `id:${row.color.id}` : `unknown:${row.planId}`) || [];
      const colorCount = new Set(shapeGroup.map(item => item.color?.id).filter(value => value != null)).size;
      const shapeCount = new Set(colorGroup.map(shapeKey)).size;
      const shapeComplete = colorCount > 1 && allAtSameStep(shapeGroup);
      const colorComplete = row.color?.id != null && shapeCount > 1 && allAtSameStep(colorGroup);
      row.coordination = { shapeComplete, colorComplete, both: shapeComplete && colorComplete, colorCount, shapeCount };
    });
  }

  function buildStoragePlan(inputRows) {
    const context = planningContext(inputRows);
    const rows = inputRows.map((row, index) => ({ ...row, planId: index, sorting: pieceDifficulty(row, context, index) }));
    const missing = rows.filter(row => !String(row.location || '').trim()).sort((a, b) => a.sorting.score - b.sorting.score);
    const cases = new Map();
    rows.filter(row => String(row.location || '').trim()).forEach(row => {
      const location = String(row.location).trim();
      cases.set(location, [...(cases.get(location) || []), row]);
    });
    const visits = [...cases].flatMap(([location, parts]) => visitsForCase(location, parts));
    visits.sort((a, b) => a.score - b.score || a.location.localeCompare(b.location, 'fr', { numeric: true }) || a.visitIndex - b.visitIndex);
    visits.forEach((visit, index) => { visit.step = index + 1; });
    addCoordinationIndicators(rows, visits);
    return { rows, visits, missing };
  }

  return { rgbProfile, physicalProfile, pieceDifficulty, shapeKey, buildStoragePlan };
});
