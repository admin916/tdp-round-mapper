/* Geometry shared by Heat and Aim. All coordinates are [latitude, longitude]. */
globalThis.TDPHoleSpatial = (() => {
  function inside(p, poly) {
    if (!poly?.length) return false;
    if (Array.isArray(poly[0][0])) return inside(p, poly[0]) && !poly.slice(1).some(r => inside(p, r));
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[0] > p[0]) !== (b[0] > p[0]) && p[1] < (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]) + a[1]) hit = !hit;
    }
    return hit;
  }
  function nearest(p, line) {
    const ky = 111132, kx = 111320 * Math.cos(p[0] * Math.PI / 180);
    let best = {distance: Infinity, along: 0}, travelled = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], x = (b[1] - a[1]) * kx, y = (b[0] - a[0]) * ky;
      const px = (p[1] - a[1]) * kx, py = (p[0] - a[0]) * ky, length = Math.hypot(x, y);
      const t = length ? Math.max(0, Math.min(1, (px * x + py * y) / (length * length))) : 0;
      const distance = Math.hypot(px - t * x, py - t * y);
      if (distance < best.distance) best = {distance, along: travelled + t * length};
      travelled += length;
    }
    return best;
  }
  const greenContains = (h, p) => h.green.polygons ? h.green.polygons.some(poly => inside(p, poly)) : inside(p, h.green.poly);
  function forHole(course, hole) {
    const neighbours = course.holes.filter(h => h.num !== hole.num);
    const polygons = course.overlays || {};
    const inLayer = (p, type) => (polygons[type] || []).some(poly => inside(p, poly));
    function contains(p) {
      if (greenContains(hole, p)) return true;
      if (neighbours.some(h => greenContains(h, p))) return false;
      if (polygons.boundary?.length && !inLayer(p, 'boundary')) return false;
      const own = nearest(p, hole.line).distance;
      if (own > 45) return false;
      return !neighbours.some(h => nearest(p, h.line).distance + 1 < own);
    }
    const hasFairways = (polygons.fairway || []).some(poly => {
      const ring = Array.isArray(poly[0]?.[0]) ? poly[0] : poly;
      return ring.some(p => contains(p));
    });
    /* Unmapped ground: on a hole whose fairway has been mapped it is rough; on a hole with no
       fairway polygons at all it is unknown, and the aim/heat models assume it plays as fairway
       (the coverage badge on the map already says fairways are not mapped). */
    const unmapped = hasFairways ? 'rough' : 'fairway';
    function lie(p) {
      if (!contains(p)) return 'outside';
      if (greenContains(hole, p)) return 'green';
      for (const [type, value] of [['water','penalty'],['penalty','penalty'],['bunker','bunker'],['woodland','woodland'],['tee','tee'],['fairway','fairway'],['rough','firstcut']]) {
        if (inLayer(p, type)) return value;
      }
      return unmapped;
    }
    const canAim = p => contains(p) && ['fairway', 'green', 'firstcut'].includes(lie(p));
    return {contains, lie, canAim, hasFairways, progress: p => nearest(p, hole.line).along};
  }
  return {inside, nearest, greenContains, forHole};
})();
