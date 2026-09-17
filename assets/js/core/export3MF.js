/*
 * Make It — 3MF export. Packages one or more colored solid meshes into a
 * valid .3mf (Core Spec) container: [Content_Types].xml + _rels/.rels +
 * 3D/3dmodel.model, zipped with the STORE method. Keeping base and design
 * as separate objects with their own <base> material preserves per-part
 * color information that a plain STL cannot carry.
 */
(function (root) {
  'use strict';

  var Zip = (typeof module !== 'undefined' && module.exports)
    ? require('./exportZip.js')
    : root.MI.ExportZip;

  // objects: array of { mesh: {vertices,triangles}, name: string, colorHex: '#RRGGBB' }
  function buildThreeMF(objects) {
    var materialsXml = objects.map(function (o) {
      var hex = (o.colorHex || '#CCCCCC').replace('#', '').toUpperCase();
      return '      <base name="' + escapeXml(o.name || 'Part') + '" displaycolor="#' + hex + 'FF"/>';
    }).join('\n');

    var objectsXml = objects.map(function (o, idx) {
      var objId = idx + 2; // id 1 reserved for the basematerials group
      var vlines = o.mesh.vertices.map(function (v) {
        return '        <vertex x="' + fmt(v[0]) + '" y="' + fmt(v[1]) + '" z="' + fmt(v[2]) + '"/>';
      }).join('\n');
      var tlines = o.mesh.triangles.map(function (t) {
        return '        <triangle v1="' + t[0] + '" v2="' + t[1] + '" v3="' + t[2] + '"/>';
      }).join('\n');
      return '    <object id="' + objId + '" type="model" pid="1" pindex="' + idx + '">\n' +
        '      <mesh>\n' +
        '        <vertices>\n' + vlines + '\n        </vertices>\n' +
        '        <triangles>\n' + tlines + '\n        </triangles>\n' +
        '      </mesh>\n' +
        '    </object>';
    }).join('\n');

    var buildXml = objects.map(function (o, idx) {
      return '    <item objectid="' + (idx + 2) + '"/>';
    }).join('\n');

    var model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
      '  <metadata name="Application">Make It - makeit.tools</metadata>\n' +
      '  <resources>\n' +
      '    <basematerials id="1">\n' + materialsXml + '\n    </basematerials>\n' +
      objectsXml + '\n' +
      '  </resources>\n' +
      '  <build>\n' + buildXml + '\n  </build>\n' +
      '</model>\n';

    var contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
      '</Types>\n';

    var rels = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
      '</Relationships>\n';

    return Zip.buildZip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: '3D/3dmodel.model', data: model }
    ]);
  }

  function fmt(n) { return Math.round(n * 100000) / 100000; }
  function escapeXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var Export3MF = { buildThreeMF: buildThreeMF };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Export3MF;
  } else {
    root.MI = root.MI || {};
    root.MI.Export3MF = Export3MF;
  }
})(typeof window !== 'undefined' ? window : global);
