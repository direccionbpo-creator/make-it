/*
 * Make It — DXF export (AutoCAD 2000 / AC1015 ASCII), LWPOLYLINE entities.
 * Produces a minimal but valid DXF that imports cleanly into common
 * CAD/CAM software. Units are set via $INSUNITS (4 = millimeters).
 */
(function (root) {
  'use strict';

  // paths: array of { points: [[x,y],...], closed: bool } in mm.
  function buildDXF(paths) {
    var handle = 0x40;
    function nextHandle() { return (handle++).toString(16).toUpperCase(); }

    var lines = [];
    function w(code, value) { lines.push(String(code)); lines.push(String(value)); }

    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1015');
    w(9, '$INSUNITS'); w(70, 4); // millimeters
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, 1);
    w(0, 'LAYER'); w(2, '0'); w(70, 0); w(62, 7); w(6, 'CONTINUOUS');
    w(0, 'ENDTAB');
    w(0, 'ENDSEC');

    w(0, 'SECTION'); w(2, 'ENTITIES');
    paths.forEach(function (p) {
      var pts = p.points;
      if (!pts || pts.length < 2) return;
      w(0, 'LWPOLYLINE');
      w(5, nextHandle());
      w(100, 'AcDbEntity');
      w(8, '0');
      w(100, 'AcDbPolyline');
      w(90, pts.length);
      w(70, p.closed !== false ? 1 : 0);
      w(43, 0);
      pts.forEach(function (pt) {
        w(10, round(pt[0]));
        w(20, round(pt[1]));
      });
    });
    w(0, 'ENDSEC');
    w(0, 'EOF');

    return lines.join('\r\n') + '\r\n';
  }

  function round(n) { return Math.round(n * 10000) / 10000; }

  var ExportDXF = { buildDXF: buildDXF };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportDXF;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportDXF = ExportDXF;
  }
})(typeof window !== 'undefined' ? window : global);
