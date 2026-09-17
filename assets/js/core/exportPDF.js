/*
 * Make It — minimal, hand-written, valid single-page PDF export.
 * Used for the printable stencil: draws the (bridged) cut paths as vector
 * strokes at real-world scale, so it prints true-to-size.
 */
(function (root) {
  'use strict';

  var MM_TO_PT = 72 / 25.4;

  // paths: array of { points: [[x,y],...], closed: bool } in millimetres.
  function buildPDF(paths, widthMm, heightMm, opts) {
    opts = opts || {};
    var pageW = widthMm * MM_TO_PT;
    var pageH = heightMm * MM_TO_PT;
    var lineWidthPt = (opts.lineWidthMm || 0.25) * MM_TO_PT;

    var content = [];
    content.push(fmt(lineWidthPt) + ' w');
    content.push('0 0 0 RG');
    content.push('1 J 1 j'); // round caps/joins so bridge gaps look clean

    paths.forEach(function (p) {
      var pts = p.points;
      if (!pts || pts.length < 2) return;
      var first = toPdfXY(pts[0], pageH);
      content.push(fmt(first[0]) + ' ' + fmt(first[1]) + ' m');
      for (var i = 1; i < pts.length; i++) {
        var xy = toPdfXY(pts[i], pageH);
        content.push(fmt(xy[0]) + ' ' + fmt(xy[1]) + ' l');
      }
      content.push(p.closed !== false ? 'h S' : 'S');
    });

    var streamStr = content.join('\n');
    var objects = [];
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(pageW) + ' ' + fmt(pageH) + '] ' +
      '/Contents 4 0 R /Resources << /ProcSet [/PDF] >> >>');
    var streamBytes = streamStr.length; // pure ASCII, 1 byte per char
    objects.push('<< /Length ' + streamBytes + ' >>\nstream\n' + streamStr + '\nendstream');

    var header = '%PDF-1.4\n';
    var body = '';
    var offsets = [];
    var pos = header.length;
    objects.forEach(function (obj, idx) {
      offsets.push(pos);
      var s = (idx + 1) + ' 0 obj\n' + obj + '\nendobj\n';
      body += s;
      pos += s.length;
    });
    var xrefStart = pos;
    var xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (off) {
      xref += pad10(off) + ' 00000 n \n';
    });
    var trailer = 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

    var full = header + body + xref + trailer;
    return stringToBytes(full);
  }

  function toPdfXY(p, pageH) {
    return [p[0] * MM_TO_PT, pageH - p[1] * MM_TO_PT];
  }

  function fmt(n) { return Math.round(n * 1000) / 1000; }
  function pad10(n) { var s = String(n); while (s.length < 10) s = '0' + s; return s; }

  function stringToBytes(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
    return out;
  }

  var ExportPDF = { buildPDF: buildPDF };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportPDF;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportPDF = ExportPDF;
  }
})(typeof window !== 'undefined' ? window : global);
