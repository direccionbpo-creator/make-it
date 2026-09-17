/*
 * Make It — core geometry engine.
 * Binary mask -> polygon contours -> simplify/smooth -> triangulate -> bridge (stencil).
 * Pure JS, no dependencies. Works in the browser (window.MI.Geometry) and in Node for testing.
 */
(function (root) {
  'use strict';

  var Geometry = {};

  // ---------------------------------------------------------------------
  // 1. Contour tracing (binary mask -> closed polygon loops in pixel space)
  // ---------------------------------------------------------------------
  //
  // Walks the edges between foreground (1) and background (0) pixels.
  // Each foreground pixel contributes up to 4 directed boundary edges
  // (one per side touching a background pixel / the image border), using a
  // consistent winding convention. Shared edges between two foreground
  // pixels never appear, so loops close automatically. The resulting loops
  // are pixel-accurate "crack" contours (staircase edges); callers should
  // run simplify()/smooth() afterwards.
  //
  // mask: Uint8Array of length width*height, 1 = foreground, 0 = background.
  // Returns: array of contours, each { points: [[x,y],...], area: signedArea, hole: bool }
  //          points are in pixel-corner coordinates (0..width, 0..height).
  function traceContours(mask, width, height) {
    var get = function (x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0;
      return mask[y * width + x];
    };

    // directed edges stored as "x1,y1" -> [x2,y2]
    var edgesFrom = new Map();

    function addEdge(x1, y1, x2, y2) {
      var key = x1 + ',' + y1;
      var list = edgesFrom.get(key);
      var entry = { to: [x2, y2], used: false };
      if (!list) {
        list = [];
        edgesFrom.set(key, list);
      }
      list.push(entry);
    }

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        if (!get(x, y)) continue;
        if (!get(x, y - 1)) addEdge(x + 1, y, x, y); // top
        if (!get(x - 1, y)) addEdge(x, y, x, y + 1); // left
        if (!get(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1); // bottom
        if (!get(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y); // right
      }
    }

    var contours = [];
    edgesFrom.forEach(function (list) {
      list.forEach(function (startEntry) {
        if (startEntry.used) return;
        var points = [];
        var cur = startEntry;
        var startKey = null;
        var guard = 0;
        var maxSteps = (width + 1) * (height + 1) * 4 + 16;
        while (true) {
          cur.used = true;
          var fromKey = null;
          points.push(cur.to);
          var toKey = cur.to[0] + ',' + cur.to[1];
          if (startKey === null) {
            // remember the corner we started from (the "from" of startEntry)
          }
          var nextList = edgesFrom.get(toKey);
          if (!nextList) break;
          var next = null;
          for (var i = 0; i < nextList.length; i++) {
            if (!nextList[i].used) { next = nextList[i]; break; }
          }
          if (!next) break;
          cur = next;
          guard++;
          if (guard > maxSteps) break;
          if (points.length > 1 && cur.to[0] === points[0][0] && cur.to[1] === points[0][1]) {
            points.push(cur.to);
            cur.used = true;
            break;
          }
        }
        if (points.length >= 4) {
          // ensure closed
          var first = points[0], last = points[points.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) points.push(first.slice());
          var area = signedArea(points);
          if (Math.abs(area) > 0) {
            contours.push({ points: points, area: area, hole: area > 0 });
          }
        }
      });
    });

    return contours;
  }

  function signedArea(points) {
    var s = 0;
    for (var i = 0; i < points.length - 1; i++) {
      s += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    }
    return s / 2;
  }

  // ---------------------------------------------------------------------
  // 2. Nesting: assign each hole contour to its immediate parent
  // ---------------------------------------------------------------------
  function buildHierarchy(contours) {
    // sort by |area| descending so parents are tested before children
    var sorted = contours.slice().sort(function (a, b) { return Math.abs(b.area) - Math.abs(a.area); });
    sorted.forEach(function (c) { c.parent = null; c.children = []; });
    for (var i = 0; i < sorted.length; i++) {
      var c = sorted[i];
      var testPoint = c.points[0];
      var bestParent = null;
      var bestArea = Infinity;
      for (var j = 0; j < sorted.length; j++) {
        if (i === j) continue;
        var candidate = sorted[j];
        if (Math.abs(candidate.area) <= Math.abs(c.area)) continue;
        if (candidate.hole === c.hole) continue; // parent must alternate polarity
        if (pointInPolygon(testPoint, candidate.points) && Math.abs(candidate.area) < bestArea) {
          bestParent = candidate;
          bestArea = Math.abs(candidate.area);
        }
      }
      c.parent = bestParent;
      if (bestParent) bestParent.children.push(c);
    }
    return sorted;
  }

  function pointInPolygon(pt, poly) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = poly.length - 2; i < poly.length - 1; j = i++) {
      var xi = poly[i][0], yi = poly[i][1];
      var xj = poly[j][0], yj = poly[j][1];
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // ---------------------------------------------------------------------
  // 3. Simplification (Ramer-Douglas-Peucker) + smoothing (Chaikin)
  // ---------------------------------------------------------------------
  function simplify(points, epsilon) {
    if (points.length <= 3 || epsilon <= 0) return points.slice();
    var closed = points.length > 2 &&
      points[0][0] === points[points.length - 1][0] &&
      points[0][1] === points[points.length - 1][1];
    var pts = closed ? points.slice(0, -1) : points;
    if (pts.length <= 3) return points.slice();
    var keep = rdp(pts, epsilon);
    if (closed) keep.push(keep[0].slice());
    return keep;
  }

  function rdp(pts, epsilon) {
    var keepMask = new Array(pts.length).fill(false);
    keepMask[0] = true;
    keepMask[pts.length - 1] = true;
    rdpRecurse(pts, 0, pts.length - 1, epsilon, keepMask);
    var out = [];
    for (var i = 0; i < pts.length; i++) if (keepMask[i]) out.push(pts[i]);
    return out;
  }

  function rdpRecurse(pts, first, last, epsilon, keepMask) {
    if (last <= first + 1) return;
    var maxDist = -1, index = -1;
    var a = pts[first], b = pts[last];
    for (var i = first + 1; i < last; i++) {
      var d = perpendicularDistance(pts[i], a, b);
      if (d > maxDist) { maxDist = d; index = i; }
    }
    if (maxDist > epsilon) {
      keepMask[index] = true;
      rdpRecurse(pts, first, index, epsilon, keepMask);
      rdpRecurse(pts, index, last, epsilon, keepMask);
    }
  }

  function perpendicularDistance(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
    var projX = a[0] + t * dx, projY = a[1] + t * dy;
    return Math.hypot(p[0] - projX, p[1] - projY);
  }

  // Chaikin corner-cutting, `iterations` times. Keeps the loop closed.
  function smooth(points, iterations) {
    var pts = points;
    var closed = pts.length > 2 &&
      pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    if (closed) pts = pts.slice(0, -1);
    for (var it = 0; it < iterations; it++) {
      if (pts.length < 3) break;
      var next = [];
      for (var i = 0; i < pts.length; i++) {
        var p0 = pts[i];
        var p1 = pts[(i + 1) % pts.length];
        next.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25]);
        next.push([p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
      }
      pts = next;
    }
    if (closed) pts.push(pts[0].slice());
    return pts;
  }

  // Remove contours (and their children) whose bounding area is below a pixel threshold.
  function removeSmall(contours, minAreaPx) {
    return contours.filter(function (c) {
      return Math.abs(c.area) >= minAreaPx || (c.parent && !c.parent.hole);
    });
  }

  // ---------------------------------------------------------------------
  // 4. Stencil bridges
  // ---------------------------------------------------------------------
  // For each hole contour, cut `bridgeCount` gaps of `bridgeWidthPx` into
  // BOTH the hole boundary and its parent boundary, at evenly spaced
  // angles around the hole's centroid. Cutting a gap means removing the
  // points within the gap and leaving the path OPEN there (an actual
  // physical bridge = uncut material). Contours with no gaps stay closed.
  //
  // Input: hierarchy from buildHierarchy() (points open, not closed - last
  // point equal to first is fine, treated as closed ring).
  // Returns: array of { points: [...], closed: bool } paths ready to export.
  function addStencilBridges(hierarchy, bridgeWidthPx, bridgeCount) {
    var gapsByContour = new Map(); // contour -> array of {index} gap centers (index into ring)
    hierarchy.forEach(function (c) {
      if (!c.hole) return;
      var parent = c.parent;
      if (!parent) return;
      var ring = asOpenRing(c.points);
      var parentRing = asOpenRing(parent.points);
      var centroid = ringCentroid(ring);
      for (var b = 0; b < bridgeCount; b++) {
        var angle = (b / bridgeCount) * Math.PI * 2;
        var dir = [Math.cos(angle), Math.sin(angle)];
        var holeIdx = nearestIndexInDirection(ring, centroid, dir);
        var parentIdx = nearestIndexInDirection(parentRing, centroid, dir);
        pushGap(gapsByContour, c, ring.length, holeIdx, bridgeWidthPx);
        pushGap(gapsByContour, parent, parentRing.length, parentIdx, bridgeWidthPx);
      }
    });

    var out = [];
    hierarchy.forEach(function (c) {
      var ring = asOpenRing(c.points);
      var gaps = gapsByContour.get(c);
      if (!gaps || gaps.length === 0) {
        out.push({ points: c.points.slice(), closed: true, hole: c.hole });
        return;
      }
      out = out.concat(applyGapsToRing(ring, gaps));
    });
    return out;
  }

  function asOpenRing(points) {
    var pts = points.slice();
    if (pts.length > 1) {
      var f = pts[0], l = pts[pts.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) pts.pop();
    }
    return pts;
  }

  function ringCentroid(ring) {
    var sx = 0, sy = 0;
    ring.forEach(function (p) { sx += p[0]; sy += p[1]; });
    return [sx / ring.length, sy / ring.length];
  }

  function nearestIndexInDirection(ring, centroid, dir) {
    var best = 0, bestScore = -Infinity;
    for (var i = 0; i < ring.length; i++) {
      var v = [ring[i][0] - centroid[0], ring[i][1] - centroid[1]];
      var len = Math.hypot(v[0], v[1]) || 1e-9;
      var score = (v[0] * dir[0] + v[1] * dir[1]) / len; // cosine similarity
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  function pushGap(map, contour, ringLen, centerIdx, widthPx) {
    var arr = map.get(contour);
    if (!arr) { arr = []; map.set(contour, arr); }
    // approximate gap half-width in index-steps (~1px per index step from tracing)
    var halfSteps = Math.max(1, Math.round(widthPx / 2));
    arr.push({ center: centerIdx, half: halfSteps, ringLen: ringLen });
  }

  function applyGapsToRing(ring, gaps) {
    var n = ring.length;
    var cut = new Array(n).fill(false);
    gaps.forEach(function (g) {
      for (var d = -g.half; d <= g.half; d++) {
        cut[((g.center + d) % n + n) % n] = true;
      }
    });
    // Walk the ring starting from an uncut point, splitting into open segments.
    var startIdx = cut.indexOf(false);
    if (startIdx === -1) return []; // fully cut, nothing left (shouldn't happen)
    var segments = [];
    var current = [];
    for (var step = 0; step < n; step++) {
      var idx = (startIdx + step) % n;
      if (cut[idx]) {
        if (current.length > 1) segments.push(current);
        current = [];
      } else {
        current.push(ring[idx]);
      }
    }
    if (current.length > 1) {
      if (segments.length > 0 && !cut[startIdx]) {
        // merge wrap-around piece with the first segment if the ring end reconnects
        segments[0] = current.concat(segments[0]);
      } else {
        segments.push(current);
      }
    }
    return segments.map(function (seg) { return { points: seg, closed: false }; });
  }

  // ---------------------------------------------------------------------
  // 6. Bounding box + scaling to real-world mm
  // ---------------------------------------------------------------------
  function boundingBox(contours) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    contours.forEach(function (c) {
      var pts = c.points || c;
      pts.forEach(function (p) {
        if (p[0] < minX) minX = p[0];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[1] > maxY) maxY = p[1];
      });
    });
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
  }

  function scaleContours(contours, scaleX, scaleY, offsetX, offsetY) {
    offsetX = offsetX || 0; offsetY = offsetY || 0;
    return contours.map(function (c) {
      var pts = (c.points || c).map(function (p) {
        return [(p[0] - offsetX) * scaleX, (p[1] - offsetY) * scaleY];
      });
      var copy = Object.assign({}, c);
      copy.points = pts;
      return copy;
    });
  }

  Geometry.traceContours = traceContours;
  Geometry.signedArea = signedArea;
  Geometry.buildHierarchy = buildHierarchy;
  Geometry.pointInPolygon = pointInPolygon;
  Geometry.simplify = simplify;
  Geometry.smooth = smooth;
  Geometry.removeSmall = removeSmall;
  Geometry.addStencilBridges = addStencilBridges;
  Geometry.boundingBox = boundingBox;
  Geometry.scaleContours = scaleContours;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Geometry;
  } else {
    root.MI = root.MI || {};
    root.MI.Geometry = Geometry;
  }
})(typeof window !== 'undefined' ? window : global);
