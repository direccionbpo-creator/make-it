/*
 * Make It — binary STL export from a triangle mesh { vertices, triangles }.
 */
(function (root) {
  'use strict';

  function buildSTL(mesh, modelName) {
    var triCount = mesh.triangles.length;
    var buffer = new ArrayBuffer(84 + triCount * 50);
    var view = new DataView(buffer);
    var headerText = ('Make It - ' + (modelName || 'model') + ' - fabrication-ready STL').slice(0, 79);
    for (var i = 0; i < headerText.length; i++) view.setUint8(i, headerText.charCodeAt(i));
    view.setUint32(80, triCount, true);

    var offset = 84;
    for (var t = 0; t < triCount; t++) {
      var tri = mesh.triangles[t];
      var a = mesh.vertices[tri[0]], b = mesh.vertices[tri[1]], c = mesh.vertices[tri[2]];
      var n = faceNormal(a, b, c);
      view.setFloat32(offset, n[0], true); view.setFloat32(offset + 4, n[1], true); view.setFloat32(offset + 8, n[2], true);
      offset += 12;
      writeVec(view, offset, a); offset += 12;
      writeVec(view, offset, b); offset += 12;
      writeVec(view, offset, c); offset += 12;
      view.setUint16(offset, 0, true); offset += 2;
    }
    return new Uint8Array(buffer);
  }

  function writeVec(view, offset, v) {
    view.setFloat32(offset, v[0], true);
    view.setFloat32(offset + 4, v[1], true);
    view.setFloat32(offset + 8, v[2], true);
  }

  function faceNormal(a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    var vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy;
    var ny = uz * vx - ux * vz;
    var nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / len, ny / len, nz / len];
  }

  var ExportSTL = { buildSTL: buildSTL, faceNormal: faceNormal };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportSTL;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportSTL = ExportSTL;
  }
})(typeof window !== 'undefined' ? window : global);
