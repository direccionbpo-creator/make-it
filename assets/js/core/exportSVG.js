/*
 * Make It — SVG export. Builds a valid SVG document from vector paths
 * (in millimetres) using the evenodd fill rule so holes render correctly.
 */
(function (root) {
  'use strict';

  // paths: array of { points: [[x,y],...], closed: bool } in mm.
  // opts: { widthMm, heightMm, stroke, strokeWidth, fill, filled }
  function buildSVG(paths, opts) {
    opts = opts || {};
    var w = opts.widthMm || 100;
    var h = opts.heightMm || 100;
    var stroke = opts.stroke || '#111111';
    var strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : 0.25;
    var fill = opts.filled ? (opts.fill || '#111111') : 'none';

    var d = paths.map(function (p) {
      var pts = p.points;
      if (pts.length === 0) return '';
      var s = 'M ' + fmt(pts[0][0]) + ' ' + fmt(pts[0][1]);
      for (var i = 1; i < pts.length; i++) s += ' L ' + fmt(pts[i][0]) + ' ' + fmt(pts[i][1]);
      if (p.closed !== false) s += ' Z';
      return s;
    }).join(' ');

    var svg = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'width="' + fmt(w) + 'mm" height="' + fmt(h) + 'mm" viewBox="0 0 ' + fmt(w) + ' ' + fmt(h) + '" ' +
      'version="1.1">\n' +
      '  <title>Make It export</title>\n' +
      '  <path d="' + d + '" fill="' + fill + '" fill-rule="evenodd" ' +
      'stroke="' + stroke + '" stroke-width="' + fmt(strokeWidth) + '" stroke-linejoin="round"/>\n' +
      '</svg>\n';
    return svg;
  }

  function fmt(n) {
    return Math.round(n * 1000) / 1000;
  }

  var ExportSVG = { buildSVG: buildSVG };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportSVG;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportSVG = ExportSVG;
  }
})(typeof window !== 'undefined' ? window : global);
