/*
 * Make It — heightfield-to-solid mesher.
 * Turns a grid of per-cell heights into a closed, watertight triangle mesh
 * (a "voxel skyline": flat top per cell, flat bottom at z=0, vertical walls
 * only where a cell is taller than its neighbor). This handles silhouettes
 * WITH holes correctly and needs no polygon-with-holes triangulation.
 */
(function (root) {
  'use strict';

  // heights: Float32Array/Array length cols*rows, cell (cx,cy) -> heights[cy*cols+cx].
  // A height <= 0 means "no material in this cell".
  // cellW/cellH: physical size of one cell (mm). originX/originY: offset (mm).
  // Returns { vertices: [[x,y,z],...], triangles: [[i0,i1,i2],...] }
  function buildHeightfieldSolid(heights, cols, rows, cellW, cellH, originX, originY) {
    originX = originX || 0; originY = originY || 0;
    var vertices = [];
    var triangles = [];

    function addTri(p0, p1, p2) {
      var i = vertices.length;
      vertices.push(p0, p1, p2);
      triangles.push([i, i + 1, i + 2]);
    }

    function cellHeight(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 0;
      var h = heights[cy * cols + cx];
      return h > 0 ? h : 0;
    }

    for (var cy = 0; cy < rows; cy++) {
      for (var cx = 0; cx < cols; cx++) {
        var h = cellHeight(cx, cy);
        if (h <= 0) continue;

        var x0 = originX + cx * cellW, x1 = originX + (cx + 1) * cellW;
        var y0 = originY + cy * cellH, y1 = originY + (cy + 1) * cellH;
        var A = [x0, y0], B = [x1, y0], C = [x1, y1], D = [x0, y1];

        var At = [A[0], A[1], h], Bt = [B[0], B[1], h], Ct = [C[0], C[1], h], Dt = [D[0], D[1], h];
        var Ab = [A[0], A[1], 0], Bb = [B[0], B[1], 0], Cb = [C[0], C[1], 0], Db = [D[0], D[1], 0];

        // top (+Z outward): CCW as seen from above
        addTri(At, Bt, Ct);
        addTri(At, Ct, Dt);
        // bottom (-Z outward): reversed winding
        addTri(Ab, Cb, Bb);
        addTri(Ab, Db, Cb);

        // side walls where the neighbor is shorter (or absent) — the exposed step.
        addWallIfNeeded(cellHeight(cx, cy - 1), h, A, B, At, Bt, Ab, Bb); // north edge A->B
        addWallIfNeeded(cellHeight(cx + 1, cy), h, B, C, Bt, Ct, Bb, Cb); // east edge B->C
        addWallIfNeeded(cellHeight(cx, cy + 1), h, C, D, Ct, Dt, Cb, Db); // south edge C->D
        addWallIfNeeded(cellHeight(cx - 1, cy), h, D, A, Dt, At, Db, Ab); // west edge D->A

        function addWallIfNeeded(neighborH, ownH, p1, p2, p1top, p2top, p1bot, p2bot) {
          if (neighborH >= ownH) return; // hidden/internal face, skip
          var lo = Math.max(neighborH, 0);
          var p1lo = [p1[0], p1[1], lo], p2lo = [p2[0], p2[1], lo];
          // outward normal = edge direction (p1->p2) rotated -90 deg (derived/verified by volume test)
          addTri(p1top, p2lo, p2top);
          addTri(p1top, p1lo, p2lo);
        }
      }
    }

    return { vertices: vertices, triangles: triangles };
  }

  // Signed volume via divergence theorem (sum of signed tetra volumes from origin).
  // Positive for a correctly-wound closed outward-normal mesh.
  function meshVolume(mesh) {
    var vol = 0;
    mesh.triangles.forEach(function (t) {
      var a = mesh.vertices[t[0]], b = mesh.vertices[t[1]], c = mesh.vertices[t[2]];
      vol += (
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      ) / 6;
    });
    return vol;
  }

  // Watertight/manifold check: every directed edge (a->b) of every triangle
  // must have exactly one matching reverse edge (b->a) elsewhere in the mesh.
  function isWatertight(mesh) {
    var counts = new Map();
    function key(p) { return p.map(function (v) { return Math.round(v * 1000); }).join(','); }
    mesh.triangles.forEach(function (t) {
      for (var i = 0; i < 3; i++) {
        var a = mesh.vertices[t[i]], b = mesh.vertices[t[(i + 1) % 3]];
        var k = key(a) + '|' + key(b);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    });
    var ok = true;
    counts.forEach(function (count, k) {
      var parts = k.split('|');
      var reverse = parts[1] + '|' + parts[0];
      if ((counts.get(reverse) || 0) !== count) ok = false;
    });
    return ok;
  }

  var Mesh3D = {
    buildHeightfieldSolid: buildHeightfieldSolid,
    meshVolume: meshVolume,
    isWatertight: isWatertight
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Mesh3D;
  } else {
    root.MI = root.MI || {};
    root.MI.Mesh3D = Mesh3D;
  }
})(typeof window !== 'undefined' ? window : global);
