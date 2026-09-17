/*
 * Make It — main app controller. Upload -> choose -> configure -> download.
 * Everything below runs client-side in the visitor's browser.
 */
(function () {
  'use strict';

  var G = window.MI.Geometry;
  var IP = window.MI.ImageProcessing;
  var Mesh3D = window.MI.Mesh3D;
  var ExportSVG = window.MI.ExportSVG;
  var ExportDXF = window.MI.ExportDXF;
  var ExportSTL = window.MI.ExportSTL;
  var Export3MF = window.MI.Export3MF;
  var ExportPDF = window.MI.ExportPDF;
  var ExportPNG = window.MI.ExportPNG;

  // ---------------------------------------------------------------------
  // Mode catalogue — shared pipelines power every intent-specific page.
  // ---------------------------------------------------------------------
  var MODES = {
    print3d: {
      id: 'print3d', pipeline: 'print3d', icon: '🧊',
      title: '3D Print', desc: 'Convert image/logo into a printable 3D object.',
      formats: 'STL · 3MF'
    },
    laserCut: {
      id: 'laserCut', pipeline: 'vector', icon: '✂️',
      title: 'Laser Cut', desc: 'Create clean vector paths ready for laser cutting.',
      formats: 'SVG · DXF', filledDefault: false
    },
    laserEngrave: {
      id: 'laserEngrave', pipeline: 'engrave', icon: '🔥',
      title: 'Laser Engrave', desc: 'Prepare the image for engraving.',
      formats: 'PNG · SVG'
    },
    cnc: {
      id: 'cnc', pipeline: 'vector', icon: '⚙️',
      title: 'CNC', desc: 'Generate clean contours suitable for CNC workflows.',
      formats: 'DXF · SVG', filledDefault: false, showContourToggle: true
    },
    vinyl: {
      id: 'vinyl', pipeline: 'vector', icon: '🏷️',
      title: 'Vinyl Cutter', desc: 'Convert the design into clean cutting paths.',
      formats: 'SVG', filledDefault: false
    },
    stencil: {
      id: 'stencil', pipeline: 'stencil', icon: '🎨',
      title: 'Stencil', desc: 'Auto-bridged stencil so islands stay attached.',
      formats: 'SVG · PDF'
    },
    svg: {
      id: 'svg', pipeline: 'vector', icon: '📐',
      title: 'Image to SVG', desc: 'General-purpose vectorization.',
      formats: 'SVG · DXF', filledDefault: true, hidden: true
    },
    dxf: {
      id: 'dxf', pipeline: 'vector', icon: '📐',
      title: 'Image to DXF', desc: 'Vector contours for CAD/CAM.',
      formats: 'DXF · SVG', filledDefault: false, hidden: true
    }
  };

  var HOME_CARD_ORDER = ['print3d', 'laserCut', 'laserEngrave', 'cnc', 'vinyl', 'stencil'];

  // ---------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function track(event, data) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: event }, data || {}));
      if (window.location.hostname === 'localhost' || window.location.search.indexOf('debug=1') > -1) {
        console.debug('[analytics]', event, data || {});
      }
    } catch (e) { /* analytics must never break the tool */ }
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function downloadBytes(bytes, filename, mime) {
    var blob = new Blob([bytes], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function showAdGateThenDownload(fn) {
    var backdrop = el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal-card' }, [
        el('h4', {}, ['Preparing your file…']),
        el('p', {}, ['This only takes a second.']),
        el('div', { class: 'ad-slot', style: 'height:100px;margin-top:10px;' }, ['ADVERTISEMENT']),
        el('button', { class: 'btn modal-close', onclick: close }, ['Close'])
      ])
    ]);
    document.body.appendChild(backdrop);
    var done = false;
    function close() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
    function finish() { if (done) return; done = true; close(); fn(); }
    setTimeout(finish, 900);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) finish(); });
  }

  function toast(msg, isError) {
    var t = el('div', { class: 'toast' + (isError ? ' error' : '') }, [msg]);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  // ---------------------------------------------------------------------
  // App mount
  // ---------------------------------------------------------------------
  function mount(root, pageConfig) {
    pageConfig = pageConfig || {};
    var state = {
      file: null,
      canvas: null,
      mode: pageConfig.mode || null,
      params: {},
      preview3d: null,
      debounceTimer: null
    };

    root.innerHTML = '';
    var uploadSection = el('div', { class: 'upload-section' });
    var pickerSection = el('div', { class: 'picker-section', style: 'display:none' });
    var workspaceSection = el('div', { class: 'workspace-section', style: 'display:none' });
    root.appendChild(uploadSection);
    root.appendChild(pickerSection);
    root.appendChild(workspaceSection);

    renderUpload(uploadSection);

    // ---- Upload stage ----
    function renderUpload(container) {
      var input = el('input', {
        type: 'file', class: 'file-input', accept: '.png,.jpg,.jpeg,.webp,.svg',
        onchange: function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); }
      });
      var dz = el('div', { class: 'dropzone', tabindex: '0' }, [
        el('div', { class: 'dz-icon' }, ['📁']),
        el('div', { class: 'dz-title' }, ['Drop your image here']),
        el('div', { class: 'dz-sub' }, ['or paste from clipboard (Ctrl/Cmd+V)']),
        el('button', { class: 'btn btn-primary btn-lg', onclick: function (e) { e.stopPropagation(); input.click(); } }, ['Choose file']),
        input
      ]);
      dz.addEventListener('click', function () { input.click(); });
      dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragover'); });
      dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
      dz.addEventListener('drop', function (e) {
        e.preventDefault(); dz.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
      });
      window.addEventListener('paste', function (e) {
        var items = (e.clipboardData || {}).items || [];
        for (var i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') === 0) {
            handleFile(items[i].getAsFile());
            break;
          }
        }
      });
      container.appendChild(dz);
      container.appendChild(el('div', { class: 'formats-line' }, [
        'Supported: ', el('code', {}, ['PNG']), ' ', el('code', {}, ['JPG']), ' ',
        el('code', {}, ['WEBP']), ' ', el('code', {}, ['SVG']), ' · processed on your device, nothing is uploaded.'
      ]));
    }

    function handleFile(file) {
      var okTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
      var okExt = /\.(png|jpe?g|webp|svg)$/i.test(file.name || '');
      if (okTypes.indexOf(file.type) === -1 && !okExt) {
        toast('Unsupported file. Use PNG, JPG, WEBP or SVG.', true);
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast('File is larger than 20 MB — try a smaller image.', true);
        return;
      }
      track('upload_file', { type: file.type, size: file.size });
      IP.Canvas.loadFileToCanvas(file, 1100).then(function (canvas) {
        state.file = file;
        state.canvas = canvas;
        uploadSection.style.display = 'none';
        if (state.mode) {
          selectMode(state.mode);
        } else {
          renderPicker();
        }
      }).catch(function (err) {
        toast(err.message || 'Could not read that file.', true);
      });
    }

    // ---- Mode picker (homepage only) ----
    function renderPicker() {
      pickerSection.innerHTML = '';
      pickerSection.style.display = 'block';
      pickerSection.appendChild(el('h2', { style: 'font-size:20px;margin-top:10px;' }, ['What do you want to make?']));
      var grid = el('div', { class: 'modes-grid' });
      HOME_CARD_ORDER.forEach(function (id) {
        var m = MODES[id];
        grid.appendChild(el('button', { class: 'mode-card', onclick: function () { track('select_manufacturing_method', { mode: id }); selectMode(id); } }, [
          el('div', { class: 'mc-icon' }, [m.icon]),
          el('div', { class: 'mc-title' }, [m.title]),
          el('div', { class: 'mc-desc' }, [m.desc]),
          el('div', { class: 'mc-formats' }, [m.formats])
        ]));
      });
      pickerSection.appendChild(grid);
    }

    // ---- Mode switch tabs (shown once a mode is active) ----
    function renderModeTabs(container, activeId) {
      var tabs = el('div', { class: 'mode-tabs' });
      HOME_CARD_ORDER.forEach(function (id) {
        var m = MODES[id];
        tabs.appendChild(el('button', {
          class: 'mode-tab' + (id === activeId ? ' active' : ''),
          onclick: function () { selectMode(id); }
        }, [m.icon + ' ' + m.title]));
      });
      container.appendChild(tabs);
    }

    function selectMode(modeId) {
      state.mode = modeId;
      pickerSection.style.display = 'none';
      state.params = defaultParams(modeId);
      renderWorkspace();
    }

    // ---------------------------------------------------------------------
    // Param defaults per mode
    // ---------------------------------------------------------------------
    function defaultParams(modeId) {
      var m = MODES[modeId];
      if (m.pipeline === 'vector') {
        return {
          threshold: 128, invert: false, bgRemoval: true, bgTolerance: 36,
          smoothEdges: 1, despeckle: 12, detail: 1.4, pathSmoothing: 1,
          filled: !!m.filledDefault, includeInner: true,
          widthMm: 100, heightMm: 100, keepProportions: true
        };
      }
      if (m.pipeline === 'stencil') {
        return {
          threshold: 128, invert: false, bgRemoval: true, bgTolerance: 36,
          smoothEdges: 1, despeckle: 12, detail: 1.4, pathSmoothing: 1,
          widthMm: 100, heightMm: 100, keepProportions: true,
          bridgeWidthMm: 3, bridgeCount: 3
        };
      }
      if (m.pipeline === 'engrave') {
        return {
          engraveMode: 'dither', contrast: 10, brightness: 0, threshold: 128,
          invert: false
        };
      }
      if (m.pipeline === 'print3d') {
        return {
          type: 'embossed', threshold: 128, invert: false, bgRemoval: true, bgTolerance: 36,
          smoothEdges: 1, despeckle: 12,
          widthMm: 80, heightMm: 80, keepProportions: true,
          baseThicknessMm: 3, designHeightMm: 2, addBase: true,
          baseColor: '#3b7de8', designColor: '#e84b3b'
        };
      }
      return {};
    }

    // ---------------------------------------------------------------------
    // Generic control renderer
    // ---------------------------------------------------------------------
    function controlSpecsFor(modeId) {
      var m = MODES[modeId];
      var common = [];
      if (m.pipeline === 'vector' || m.pipeline === 'stencil' || m.pipeline === 'print3d') {
        common = [
          { type: 'checkbox', key: 'bgRemoval', label: 'Remove background automatically' },
          { type: 'range', key: 'threshold', label: 'Threshold', min: 1, max: 254, step: 1 },
          { type: 'checkbox', key: 'invert', label: 'Invert' },
          { type: 'range', key: 'smoothEdges', label: 'Smooth edges', min: 0, max: 5, step: 1 },
          { type: 'range', key: 'despeckle', label: 'Remove small details', min: 0, max: 80, step: 1 }
        ];
      }
      if (m.pipeline === 'vector') {
        common = common.concat([
          { type: 'range', key: 'detail', label: 'Detail level', min: 0.2, max: 4, step: 0.1 },
          { type: 'range', key: 'pathSmoothing', label: 'Path smoothing', min: 0, max: 3, step: 1 }
        ]);
        if (!MODES[modeId].filledDefault) {
          common.push({ type: 'checkbox', key: 'filled', label: 'Filled shape (instead of outline)' });
        }
        if (MODES[modeId].showContourToggle) {
          common.push({ type: 'checkbox', key: 'includeInner', label: 'Include inner contours' });
        }
        common = common.concat([
          { type: 'row', items: [
            { type: 'number', key: 'widthMm', label: 'Width', unit: 'mm', min: 1, max: 2000, step: 0.5 },
            { type: 'number', key: 'heightMm', label: 'Height', unit: 'mm', min: 1, max: 2000, step: 0.5 }
          ] },
          { type: 'checkbox', key: 'keepProportions', label: 'Keep proportions' }
        ]);
      }
      if (m.pipeline === 'stencil') {
        common = common.concat([
          { type: 'range', key: 'detail', label: 'Simplification', min: 0.2, max: 4, step: 0.1 },
          { type: 'range', key: 'bridgeWidthMm', label: 'Bridge width', min: 0.6, max: 8, step: 0.2, unit: 'mm' },
          { type: 'range', key: 'bridgeCount', label: 'Number of bridges', min: 1, max: 8, step: 1 },
          { type: 'row', items: [
            { type: 'number', key: 'widthMm', label: 'Width', unit: 'mm', min: 1, max: 2000, step: 0.5 },
            { type: 'number', key: 'heightMm', label: 'Height', unit: 'mm', min: 1, max: 2000, step: 0.5 }
          ] },
          { type: 'checkbox', key: 'keepProportions', label: 'Keep proportions' }
        ]);
      }
      if (m.pipeline === 'engrave') {
        common = [
          { type: 'segmented', key: 'engraveMode', label: 'Mode', options: [
            { value: 'bw', label: 'Black & White' }, { value: 'grayscale', label: 'Grayscale' }, { value: 'dither', label: 'Dither' }
          ] },
          { type: 'range', key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
          { type: 'range', key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
          { type: 'range', key: 'threshold', label: 'Threshold', min: 1, max: 254, step: 1 },
          { type: 'checkbox', key: 'invert', label: 'Invert' }
        ];
      }
      if (m.pipeline === 'print3d') {
        common = [
          { type: 'segmented', key: 'type', label: 'Type', options: [
            { value: 'relief', label: 'Relief' }, { value: 'embossed', label: 'Embossed' },
            { value: 'debossed', label: 'Debossed' }, { value: 'standalone', label: 'Standalone' }
          ] }
        ].concat(common).concat([
          { type: 'row', items: [
            { type: 'number', key: 'widthMm', label: 'Width', unit: 'mm', min: 5, max: 400, step: 1 },
            { type: 'number', key: 'heightMm', label: 'Height', unit: 'mm', min: 5, max: 400, step: 1 }
          ] },
          { type: 'checkbox', key: 'keepProportions', label: 'Keep proportions' },
          { type: 'row', items: [
            { type: 'number', key: 'baseThicknessMm', label: 'Base thickness', unit: 'mm', min: 0.4, max: 30, step: 0.2 },
            { type: 'number', key: 'designHeightMm', label: 'Design height', unit: 'mm', min: 0.2, max: 30, step: 0.2 }
          ] },
          { type: 'checkbox', key: 'addBase', label: 'Add base' },
          { type: 'colorpair', keys: ['baseColor', 'designColor'], labels: ['Base color', 'Design color'] }
        ]);
      }
      return common;
    }

    function renderControls(container, specs, params, onChange) {
      container.innerHTML = '';
      specs.forEach(function (spec) { container.appendChild(renderControl(spec, params, onChange)); });
    }

    function renderControl(spec, params, onChange) {
      if (spec.type === 'row') {
        var row = el('div', { class: 'control-row' });
        spec.items.forEach(function (s) { row.appendChild(renderControl(s, params, onChange)); });
        return row;
      }
      if (spec.type === 'checkbox') {
        var cb = el('input', {
          type: 'checkbox', onchange: function (e) { params[spec.key] = e.target.checked; onChange(); }
        });
        cb.checked = !!params[spec.key];
        return el('label', { class: 'checkbox-row' }, [cb, spec.label]);
      }
      if (spec.type === 'segmented') {
        var seg = el('div', { class: 'segmented' });
        spec.options.forEach(function (opt) {
          var btn = el('button', {
            class: params[spec.key] === opt.value ? 'active' : '',
            onclick: function () {
              params[spec.key] = opt.value;
              Array.prototype.forEach.call(seg.children, function (b) { b.classList.remove('active'); });
              btn.classList.add('active');
              onChange();
            }
          }, [opt.label]);
          seg.appendChild(btn);
        });
        var wrap = el('div', { class: 'control-group' }, [el('label', {}, [spec.label]), seg]);
        return wrap;
      }
      if (spec.type === 'range') {
        var valSpan = el('span', { class: 'val' }, [String(params[spec.key])]);
        var range = el('input', {
          type: 'range', min: spec.min, max: spec.max, step: spec.step, value: params[spec.key],
          oninput: function (e) {
            params[spec.key] = parseFloat(e.target.value);
            valSpan.textContent = params[spec.key] + (spec.unit || '');
            onChange();
          }
        });
        return el('div', { class: 'control-group' }, [
          el('label', {}, [spec.label, valSpan]), range
        ]);
      }
      if (spec.type === 'number') {
        var num = el('input', {
          type: 'number', min: spec.min, max: spec.max, step: spec.step, value: params[spec.key],
          onchange: function (e) { params[spec.key] = parseFloat(e.target.value) || 0; onChange(); }
        });
        return el('div', { class: 'control-group' }, [
          el('label', {}, [spec.label + (spec.unit ? ' (' + spec.unit + ')' : '')]), num
        ]);
      }
      if (spec.type === 'colorpair') {
        var wrap2 = el('div', { class: 'control-group' });
        spec.keys.forEach(function (key, i) {
          var input = el('input', {
            type: 'color', value: params[key],
            onchange: function (e) { params[key] = e.target.value; onChange(); }
          });
          wrap2.appendChild(el('div', { class: 'color-row' }, [input, el('span', {}, [spec.labels[i]])]));
        });
        return wrap2;
      }
      return el('div', {});
    }

    // ---------------------------------------------------------------------
    // Workspace render
    // ---------------------------------------------------------------------
    function renderWorkspace() {
      workspaceSection.innerHTML = '';
      workspaceSection.style.display = 'block';

      if (!pageConfig.mode) renderModeTabs(workspaceSection, state.mode);

      var ws = el('div', { class: 'workspace' });
      var sidebar = el('div', { class: 'panel' }, [el('h3', {}, ['Adjust'])]);
      var controlsWrap = el('div', {});
      sidebar.appendChild(controlsWrap);
      sidebar.appendChild(el('div', { class: 'privacy-note' }, ['🔒 Processed locally in your browser. Your image never leaves your device.']));

      var stage = el('div', { class: 'stage' });
      var toolbar = el('div', { class: 'stage-toolbar' }, [
        el('span', { style: 'font-size:13px;font-weight:600;color:var(--text-muted)' }, ['Preview']),
        el('div', { class: 'toolbar-btns' })
      ]);
      var stageBody = el('div', {});
      var statsBar = el('div', { class: 'stats-bar' });
      stage.appendChild(toolbar);
      stage.appendChild(stageBody);
      stage.appendChild(statsBar);

      var right = el('div', {}, [
        stage,
        el('div', { class: 'download-row', id: 'download-row' }),
        el('div', { class: 'ad-slot ad-slot-incontent' }, ['ADVERTISEMENT'])
      ]);

      ws.appendChild(sidebar);
      ws.appendChild(right);
      workspaceSection.appendChild(ws);

      var pipeline = MODES[state.mode].pipeline;
      var specs = controlSpecsFor(state.mode);
      renderControls(controlsWrap, specs, state.params, scheduleRecompute);

      function scheduleRecompute() {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(recompute, 180);
      }

      function recompute() {
        try {
          if (pipeline === 'vector') runVector(stageBody, statsBar);
          else if (pipeline === 'stencil') runStencil(stageBody, statsBar);
          else if (pipeline === 'engrave') runEngrave(stageBody, statsBar);
          else if (pipeline === 'print3d') runPrint3D(stageBody, statsBar);
          track('preview_generated', { mode: state.mode });
        } catch (err) {
          console.error(err);
          stageBody.innerHTML = '';
          stageBody.appendChild(el('div', { class: 'error-box' }, ['Could not process this image: ' + err.message]));
        }
      }
      recompute();
    }

    // ---------------------------------------------------------------------
    // Shared vector pipeline (contours -> paths in mm)
    // ---------------------------------------------------------------------
    function computeVectorPaths(params, includeInnerOverride) {
      var canvas = state.canvas;
      var ctx = canvas.getContext('2d');
      var w = canvas.width, h = canvas.height;
      var imgData = ctx.getImageData(0, 0, w, h);
      var rgba = imgData.data;

      var gray = IP.toGrayscale(rgba, w, h);
      if (params.smoothEdges > 0) gray = IP.boxBlur(gray, w, h, params.smoothEdges);
      var mask = IP.threshold(gray, params.threshold, params.invert);

      if (params.bgRemoval) {
        var bg = IP.backgroundRemovalMask(rgba, w, h, params.bgTolerance);
        for (var i = 0; i < mask.length; i++) if (bg[i]) mask[i] = 0;
      }
      mask = IP.despeckle(mask, w, h, params.despeckle);

      var contours = G.traceContours(mask, w, h);
      var hierarchy = G.buildHierarchy(contours);
      var includeInner = includeInnerOverride != null ? includeInnerOverride : (params.includeInner !== false);
      if (!includeInner) hierarchy = hierarchy.filter(function (c) { return !c.hole; });

      hierarchy.forEach(function (c) {
        var simp = G.simplify(c.points, params.detail || 1);
        c.points = G.smooth(simp, params.pathSmoothing || 0);
      });

      if (hierarchy.length === 0) return { paths: [], widthMm: params.widthMm, heightMm: params.heightMm, bbox: null };

      var bbox = G.boundingBox(hierarchy);
      var scaleX = params.widthMm / (bbox.width || 1);
      var scaleY = params.keepProportions ? scaleX : params.heightMm / (bbox.height || 1);
      var scaled = G.scaleContours(hierarchy, scaleX, scaleY, bbox.minX, bbox.minY);
      var outWidthMm = bbox.width * scaleX;
      var outHeightMm = bbox.height * scaleY;

      var paths = scaled.map(function (c) { return { points: c.points, closed: true }; });
      return { paths: paths, widthMm: outWidthMm, heightMm: outHeightMm, bbox: bbox, hierarchyPx: hierarchy, scaleX: scaleX, scaleY: scaleY };
    }

    function runVector(stageBody, statsBar) {
      var params = state.params;
      var result = computeVectorPaths(params);
      var mode = MODES[state.mode];
      var svg = ExportSVG.buildSVG(result.paths, {
        widthMm: result.widthMm, heightMm: result.heightMm,
        filled: !!params.filled, strokeWidth: 0.3
      });
      renderSvgPreview(stageBody, svg);

      var nodeCount = 0;
      result.paths.forEach(function (p) { nodeCount += p.points.length; });
      renderStats(statsBar, [
        ['Dimensions', fmt1(result.widthMm) + ' × ' + fmt1(result.heightMm) + ' mm'],
        ['Paths', String(result.paths.length)],
        ['Nodes', String(nodeCount)]
      ]);

      var dxf = ExportDXF.buildDXF(result.paths);
      renderDownloads([
        { label: 'Download SVG', ext: 'svg', event: 'download_svg', run: function () { downloadBytes(svg, fileName('svg'), 'image/svg+xml'); } },
        { label: 'Download DXF', ext: 'dxf', event: 'download_dxf', run: function () { downloadBytes(dxf, fileName('dxf'), 'application/dxf'); } }
      ]);
    }

    function runStencil(stageBody, statsBar) {
      var params = state.params;
      var canvas = state.canvas;
      var w = canvas.width, h = canvas.height;
      var ctx = canvas.getContext('2d');
      var imgData = ctx.getImageData(0, 0, w, h);
      var rgba = imgData.data;
      var gray = IP.toGrayscale(rgba, w, h);
      if (params.smoothEdges > 0) gray = IP.boxBlur(gray, w, h, params.smoothEdges);
      var mask = IP.threshold(gray, params.threshold, params.invert);
      if (params.bgRemoval) {
        var bg = IP.backgroundRemovalMask(rgba, w, h, params.bgTolerance);
        for (var i = 0; i < mask.length; i++) if (bg[i]) mask[i] = 0;
      }
      mask = IP.despeckle(mask, w, h, params.despeckle);
      var contours = G.traceContours(mask, w, h);
      var hierarchy = G.buildHierarchy(contours);
      hierarchy.forEach(function (c) {
        var simp = G.simplify(c.points, params.detail || 1);
        c.points = G.smooth(simp, 1);
      });

      if (hierarchy.length === 0) {
        stageBody.innerHTML = '';
        stageBody.appendChild(el('div', { class: 'error-box' }, ['No shape detected — try lowering the threshold or turning off background removal.']));
        return;
      }

      var bbox = G.boundingBox(hierarchy);
      var scaleX = params.widthMm / (bbox.width || 1);
      var scaleY = params.keepProportions ? scaleX : params.heightMm / (bbox.height || 1);
      var bridgeWidthPx = params.bridgeWidthMm / scaleX;
      var bridged = G.addStencilBridges(hierarchy, bridgeWidthPx, params.bridgeCount);

      var scaledPaths = bridged.map(function (p) {
        return {
          points: p.points.map(function (pt) { return [(pt[0] - bbox.minX) * scaleX, (pt[1] - bbox.minY) * scaleY]; }),
          closed: p.closed
        };
      });
      var outWidthMm = bbox.width * scaleX, outHeightMm = bbox.height * scaleY;

      var holesCount = hierarchy.filter(function (c) { return c.hole; }).length;
      var svg = ExportSVG.buildSVG(scaledPaths, { widthMm: outWidthMm, heightMm: outHeightMm, filled: false, strokeWidth: 0.35 });
      renderSvgPreview(stageBody, svg);
      renderStats(statsBar, [
        ['Dimensions', fmt1(outWidthMm) + ' × ' + fmt1(outHeightMm) + ' mm'],
        ['Bridges created', String(holesCount * params.bridgeCount)],
        ['Islands', String(holesCount)]
      ]);

      var pdf = ExportPDF.buildPDF(scaledPaths, outWidthMm, outHeightMm, { lineWidthMm: 0.3 });
      renderDownloads([
        { label: 'Download SVG', run: function () { downloadBytes(svg, fileName('svg'), 'image/svg+xml'); } },
        { label: 'Download printable PDF', run: function () { downloadBytes(pdf, fileName('pdf'), 'application/pdf'); }, event: 'download_stencil' }
      ]);
    }

    function runEngrave(stageBody, statsBar) {
      var params = state.params;
      var canvas = state.canvas;
      var w = canvas.width, h = canvas.height;
      var ctx = canvas.getContext('2d');
      var rgba = ctx.getImageData(0, 0, w, h).data;
      var gray = IP.toGrayscale(rgba, w, h);
      gray = IP.adjustContrastBrightness(gray, params.contrast, params.brightness);
      if (params.invert) { var inv = new Uint8Array(gray.length); for (var i = 0; i < gray.length; i++) inv[i] = 255 - gray[i]; gray = inv; }

      var out;
      if (params.engraveMode === 'grayscale') {
        out = gray;
      } else if (params.engraveMode === 'bw') {
        out = new Uint8Array(gray.length);
        for (var j = 0; j < gray.length; j++) out[j] = gray[j] < params.threshold ? 0 : 255;
      } else {
        out = ExportPNG.ditherFloydSteinberg(gray, w, h);
      }

      var previewCanvas = ExportPNG.toCanvas(out, w, h);
      stageBody.innerHTML = '';
      var wrap = el('div', { class: 'stage-2d-preview' });
      wrap.appendChild(previewCanvas);
      stageBody.appendChild(wrap);

      renderStats(statsBar, [
        ['Resolution', w + ' × ' + h + ' px'],
        ['Mode', params.engraveMode],
        ['File size (est.)', fmtBytes(w * h * 0.9)]
      ]);

      var downloads = [
        { label: 'Download PNG', run: function () {
          ExportPNG.canvasToBlob(previewCanvas).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a'); a.href = url; a.download = fileName('png'); document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          });
        }, event: 'download_png' }
      ];
      if (params.engraveMode === 'bw') {
        downloads.push({ label: 'Download SVG', run: function () {
          var vec = computeVectorPaths(Object.assign({}, params, {
            despeckle: 6, detail: 1.2, smoothEdges: 0, bgRemoval: false, includeInner: true,
            widthMm: 100, heightMm: 100, keepProportions: true
          }));
          var svg = ExportSVG.buildSVG(vec.paths, { widthMm: vec.widthMm, heightMm: vec.heightMm, filled: true });
          downloadBytes(svg, fileName('svg'), 'image/svg+xml');
        }, event: 'download_svg' });
      }
      renderDownloads(downloads);
    }

    function runPrint3D(stageBody, statsBar) {
      var params = state.params;
      var canvas = state.canvas;
      var w = canvas.width, h = canvas.height;
      var ctx = canvas.getContext('2d');
      var rgba = ctx.getImageData(0, 0, w, h).data;
      var gray = IP.toGrayscale(rgba, w, h);
      if (params.smoothEdges > 0) gray = IP.boxBlur(gray, w, h, params.smoothEdges);
      var mask = IP.threshold(gray, params.threshold, params.invert);
      if (params.bgRemoval) {
        var bg = IP.backgroundRemovalMask(rgba, w, h, params.bgTolerance);
        for (var i = 0; i < mask.length; i++) if (bg[i]) mask[i] = 0;
      }
      mask = IP.despeckle(mask, w, h, params.despeckle);

      var maxCells = 110;
      var cols = w >= h ? maxCells : Math.max(8, Math.round(maxCells * w / h));
      var rows = h >= w ? maxCells : Math.max(8, Math.round(maxCells * h / w));
      var cellW = params.widthMm / cols;
      var heightMmActual = params.keepProportions ? (params.widthMm * h / w) : params.heightMm;
      var cellH = heightMmActual / rows;

      var baseGrid = new Float32Array(cols * rows);
      var designGrid = new Float32Array(cols * rows);
      var blockW = w / cols, blockH = h / rows;

      for (var cy = 0; cy < rows; cy++) {
        for (var cx = 0; cx < cols; cx++) {
          var x0 = Math.floor(cx * blockW), x1 = Math.max(x0 + 1, Math.floor((cx + 1) * blockW));
          var y0 = Math.floor(cy * blockH), y1 = Math.max(y0 + 1, Math.floor((cy + 1) * blockH));
          var sum = 0, count = 0, fg = false;
          for (var py = y0; py < y1 && py < h; py++) {
            for (var px = x0; px < x1 && px < w; px++) {
              var idx = py * w + px;
              sum += gray[idx]; count++;
              if (mask[idx]) fg = true;
            }
          }
          var avgGray = count ? sum / count : 255;
          var intensity = (255 - avgGray) / 255;
          var ci = cy * cols + cx;

          if (params.type === 'relief') {
            baseGrid[ci] = params.baseThicknessMm;
            designGrid[ci] = fg ? params.designHeightMm * intensity : 0;
          } else if (params.type === 'embossed') {
            baseGrid[ci] = params.baseThicknessMm;
            designGrid[ci] = fg ? params.designHeightMm : 0;
          } else if (params.type === 'debossed') {
            baseGrid[ci] = fg ? Math.max(params.baseThicknessMm - params.designHeightMm, 0.4) : params.baseThicknessMm;
            designGrid[ci] = 0;
          } else { // standalone
            baseGrid[ci] = params.addBase ? params.baseThicknessMm : 0;
            designGrid[ci] = fg ? params.designHeightMm : 0;
          }
        }
      }

      var combined = new Float32Array(cols * rows);
      for (var i2 = 0; i2 < combined.length; i2++) combined[i2] = baseGrid[i2] + designGrid[i2];

      var solidMesh = Mesh3D.buildHeightfieldSolid(combined, cols, rows, cellW, cellH, 0, 0);
      var watertight = Mesh3D.isWatertight(solidMesh);
      var volumeMm3 = Mesh3D.meshVolume(solidMesh);

      var hasSeparateDesign = params.type !== 'debossed';
      var previewMeshes, mfObjects;
      if (hasSeparateDesign) {
        var baseMesh = Mesh3D.buildHeightfieldSolid(baseGrid, cols, rows, cellW, cellH, 0, 0);
        var designMeshRaw = Mesh3D.buildHeightfieldSolid(designGrid, cols, rows, cellW, cellH, 0, 0);
        var baseLevel = params.type === 'standalone' && !params.addBase ? 0 : params.baseThicknessMm;
        var designMesh = { vertices: designMeshRaw.vertices.map(function (v) { return [v[0], v[1], v[2] + baseLevel]; }), triangles: designMeshRaw.triangles };
        previewMeshes = [
          { vertices: baseMesh.vertices, triangles: baseMesh.triangles, colorHex: params.baseColor },
          { vertices: designMesh.vertices, triangles: designMesh.triangles, colorHex: params.designColor }
        ];
        mfObjects = [
          { mesh: baseMesh, name: 'Base', colorHex: params.baseColor },
          { mesh: designMesh, name: 'Design', colorHex: params.designColor }
        ];
      } else {
        previewMeshes = [{ vertices: solidMesh.vertices, triangles: solidMesh.triangles, colorHex: params.baseColor }];
        mfObjects = [{ mesh: solidMesh, name: 'Model', colorHex: params.baseColor }];
      }

      stageBody.innerHTML = '';
      var canvasWrap = el('div', { class: 'stage-canvas-wrap' });
      stageBody.appendChild(canvasWrap);

      window.MI.Preview3D.ensureLoaded().then(function () {
        if (state.preview3d) { state.preview3d.dispose(); state.preview3d = null; }
        state.preview3d = window.MI.Preview3D.create(canvasWrap);
        state.preview3d.setMeshes(previewMeshes, params.widthMm, heightMmActual);
        wireStageToolbar();
      }).catch(function (err) {
        canvasWrap.innerHTML = '';
        canvasWrap.appendChild(el('div', { class: 'error-box' }, [err.message]));
      });

      function wireStageToolbar() {
        var btns = stageBody.parentNode.querySelector('.toolbar-btns');
        if (!btns) return;
        btns.innerHTML = '';
        btns.appendChild(el('button', { title: 'Reset view', onclick: function () { state.preview3d.resetCamera(); } }, ['⟳']));
        btns.appendChild(el('button', { title: 'Top view', onclick: function () { state.preview3d.topView(); } }, ['⬒']));
      }

      var maxHeight = 0;
      for (var i3 = 0; i3 < combined.length; i3++) if (combined[i3] > maxHeight) maxHeight = combined[i3];

      renderStats(statsBar, [
        ['Model dimensions', fmt1(params.widthMm) + ' × ' + fmt1(heightMmActual) + ' × ' + fmt1(maxHeight) + ' mm'],
        ['Triangles', String(solidMesh.triangles.length)],
        ['Watertight', watertight ? 'Yes' : 'Check needed'],
        ['Est. volume', fmt1(volumeMm3 / 1000) + ' cm³']
      ]);

      renderDownloads([
        { label: 'Download STL', run: function () {
          var stl = ExportSTL.buildSTL(solidMesh, state.file.name);
          downloadBytes(stl, fileName('stl'), 'model/stl');
        }, event: 'download_stl' },
        { label: 'Download 3MF', run: function () {
          var zip = Export3MF.buildThreeMF(mfObjects);
          downloadBytes(zip, fileName('3mf'), 'model/3mf');
        }, event: 'download_3mf' }
      ]);
    }

    // ---------------------------------------------------------------------
    // Rendering helpers
    // ---------------------------------------------------------------------
    function renderSvgPreview(stageBody, svgString) {
      stageBody.innerHTML = '';
      var wrap = el('div', { class: 'stage-2d-preview', html: svgString });
      stageBody.appendChild(wrap);
    }

    function renderStats(statsBar, pairs) {
      statsBar.innerHTML = '';
      pairs.forEach(function (p) {
        statsBar.appendChild(el('div', { class: 'stat' }, [
          el('div', { class: 'stat-label' }, [p[0]]),
          el('div', { class: 'stat-value' }, [p[1]])
        ]));
      });
    }

    function renderDownloads(items) {
      var row = workspaceSection.querySelector('#download-row');
      if (!row) return;
      row.innerHTML = '';
      items.forEach(function (item) {
        row.appendChild(el('button', {
          class: 'btn btn-primary btn-lg',
          onclick: function () {
            track(item.event || 'download_file', { mode: state.mode });
            showAdGateThenDownload(item.run);
          }
        }, [item.label]));
      });
    }

    function fileName(ext) {
      var base = (state.file && state.file.name ? state.file.name.replace(/\.[^.]+$/, '') : 'makeit-design');
      return base + '-' + state.mode + '.' + ext;
    }

    function fmt1(n) { return Math.round(n * 10) / 10; }
  }

  window.MI = window.MI || {};
  window.MI.App = { mount: mount, MODES: MODES };
})();
