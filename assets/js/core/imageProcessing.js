/*
 * Make It — client-side image processing.
 * Pure pixel-array functions (unit-testable in Node) + a thin canvas wrapper
 * (browser only). Everything here runs locally; nothing is uploaded anywhere.
 */
(function (root) {
  'use strict';

  var IP = {};

  // ---------------------------------------------------------------------
  // Pure array operations (Uint8ClampedArray RGBA in, typed arrays out)
  // ---------------------------------------------------------------------

  function toGrayscale(rgba, w, h) {
    var gray = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < gray.length; i++, p += 4) {
      // Rec. 601 luma
      gray[i] = (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) | 0;
    }
    return gray;
  }

  function adjustContrastBrightness(gray, contrast, brightness) {
    // contrast: -100..100, brightness: -100..100
    var c = (100 + contrast) / 100;
    var out = new Uint8Array(gray.length);
    for (var i = 0; i < gray.length; i++) {
      var v = (gray[i] - 128) * c + 128 + brightness;
      out[i] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    return out;
  }

  function boxBlur(gray, w, h, radius) {
    if (radius <= 0) return gray.slice();
    var horiz = new Float32Array(w * h);
    var out = new Uint8Array(w * h);
    var r = radius;
    for (var y = 0; y < h; y++) {
      var rowOff = y * w;
      var sum = 0;
      for (var x = -r; x <= r; x++) sum += gray[rowOff + clampi(x, 0, w - 1)];
      for (var x2 = 0; x2 < w; x2++) {
        horiz[rowOff + x2] = sum;
        var addX = x2 + r + 1, subX = x2 - r;
        sum += gray[rowOff + clampi(addX, 0, w - 1)] - gray[rowOff + clampi(subX, 0, w - 1)];
      }
    }
    for (var x3 = 0; x3 < w; x3++) {
      var sum2 = 0;
      for (var y2 = -r; y2 <= r; y2++) sum2 += horiz[clampi(y2, 0, h - 1) * w + x3];
      for (var y3 = 0; y3 < h; y3++) {
        out[y3 * w + x3] = Math.round(sum2 / ((2 * r + 1) * (2 * r + 1)));
        var addY = y3 + r + 1, subY = y3 - r;
        sum2 += horiz[clampi(addY, 0, h - 1) * w + x3] - horiz[clampi(subY, 0, h - 1) * w + x3];
      }
    }
    return out;
  }

  function clampi(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // level: 0-255. invert: if true, LIGHT pixels become foreground instead of dark.
  function threshold(gray, level, invert) {
    var mask = new Uint8Array(gray.length);
    for (var i = 0; i < gray.length; i++) {
      var fg = gray[i] < level;
      if (invert) fg = !fg;
      mask[i] = fg ? 1 : 0;
    }
    return mask;
  }

  function invertMask(mask) {
    var out = new Uint8Array(mask.length);
    for (var i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
    return out;
  }

  // Remove connected components (4-connectivity) smaller than minPixels.
  function despeckle(mask, w, h, minPixels) {
    if (minPixels <= 1) return mask.slice();
    var visited = new Uint8Array(mask.length);
    var out = mask.slice();
    var stack = new Int32Array(mask.length);
    for (var start = 0; start < mask.length; start++) {
      if (!mask[start] || visited[start]) continue;
      var sp = 0;
      stack[sp++] = start;
      visited[start] = 1;
      var component = [start];
      while (sp > 0) {
        var idx = stack[--sp];
        var x = idx % w, y = (idx / w) | 0;
        var neighbors = [
          x > 0 ? idx - 1 : -1,
          x < w - 1 ? idx + 1 : -1,
          y > 0 ? idx - w : -1,
          y < h - 1 ? idx + w : -1
        ];
        for (var n = 0; n < 4; n++) {
          var ni = neighbors[n];
          if (ni >= 0 && mask[ni] && !visited[ni]) {
            visited[ni] = 1;
            stack[sp++] = ni;
            component.push(ni);
          }
        }
      }
      if (component.length < minPixels) {
        for (var ci = 0; ci < component.length; ci++) out[component[ci]] = 0;
      }
    }
    return out;
  }

  // Flood-fill background removal: starting from every border pixel, flood
  // fill through pixels whose color is within `tolerance` of the previously
  // filled pixel (chained tolerance), marking them as background (alpha=0).
  // This is a real, deterministic technique (not AI-based) that works well
  // for logos/photos with a fairly uniform background touching the edges.
  function backgroundRemovalMask(rgba, w, h, tolerance) {
    var bg = new Uint8Array(w * h); // 1 = background
    var visited = new Uint8Array(w * h);
    var stack = new Int32Array(w * h);
    var sp = 0;

    function colorAt(i) {
      var p = i * 4;
      return [rgba[p], rgba[p + 1], rgba[p + 2]];
    }
    function dist(a, b) {
      var dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
      return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    for (var x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (var y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

    function seed(x, y) {
      var i = y * w + x;
      if (visited[i]) return;
      visited[i] = 1;
      bg[i] = 1;
      stack[sp++] = i;
    }

    while (sp > 0) {
      var idx = stack[--sp];
      var cx = idx % w, cy = (idx / w) | 0;
      var col = colorAt(idx);
      var neighbors = [
        cx > 0 ? idx - 1 : -1,
        cx < w - 1 ? idx + 1 : -1,
        cy > 0 ? idx - w : -1,
        cy < h - 1 ? idx + w : -1
      ];
      for (var n = 0; n < 4; n++) {
        var ni = neighbors[n];
        if (ni < 0 || visited[ni]) continue;
        var ncol = colorAt(ni);
        if (dist(col, ncol) <= tolerance) {
          visited[ni] = 1;
          bg[ni] = 1;
          stack[sp++] = ni;
        } else {
          visited[ni] = 1; // mark visited so we don't re-test, but not bg
        }
      }
    }
    return bg; // 1 = background pixel to make transparent
  }

  IP.toGrayscale = toGrayscale;
  IP.adjustContrastBrightness = adjustContrastBrightness;
  IP.boxBlur = boxBlur;
  IP.threshold = threshold;
  IP.invertMask = invertMask;
  IP.despeckle = despeckle;
  IP.backgroundRemovalMask = backgroundRemovalMask;

  // ---------------------------------------------------------------------
  // Canvas wrapper (browser only)
  // ---------------------------------------------------------------------
  if (typeof document !== 'undefined') {
    IP.Canvas = {};

    // Loads a File/Blob (png/jpg/webp/svg) into a canvas. Returns a Promise<canvas>.
    IP.Canvas.loadFileToCanvas = function (file, maxDim) {
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = 1;
          if (maxDim && Math.max(w, h) > maxDim) scale = maxDim / Math.max(w, h);
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(url);
          resolve(canvas);
        };
        img.onerror = function (e) {
          URL.revokeObjectURL(url);
          reject(new Error('Could not decode image. Try PNG, JPG, WEBP or SVG.'));
        };
        img.src = url;
      });
    };

    IP.Canvas.cloneCanvas = function (canvas) {
      var c = document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      c.getContext('2d').drawImage(canvas, 0, 0);
      return c;
    };

    IP.Canvas.cropCanvas = function (canvas, x, y, w, h) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, c.width, c.height);
      return c;
    };

    IP.Canvas.scaleCanvas = function (canvas, w, h) {
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(canvas, 0, 0, c.width, c.height);
      return c;
    };

    IP.Canvas.rotateCanvas = function (canvas, degrees) {
      var rad = degrees * Math.PI / 180;
      var w = canvas.width, h = canvas.height;
      var absCos = Math.abs(Math.cos(rad)), absSin = Math.abs(Math.sin(rad));
      var nw = Math.round(w * absCos + h * absSin);
      var nh = Math.round(w * absSin + h * absCos);
      var c = document.createElement('canvas');
      c.width = nw; c.height = nh;
      var ctx = c.getContext('2d');
      ctx.translate(nw / 2, nh / 2);
      ctx.rotate(rad);
      ctx.drawImage(canvas, -w / 2, -h / 2);
      return c;
    };

    IP.Canvas.getImageData = function (canvas) {
      return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    };

    IP.Canvas.maskToCanvas = function (mask, w, h, fgColor, bgColor) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var imgData = ctx.createImageData(w, h);
      for (var i = 0, p = 0; i < mask.length; i++, p += 4) {
        var col = mask[i] ? fgColor : bgColor;
        imgData.data[p] = col[0];
        imgData.data[p + 1] = col[1];
        imgData.data[p + 2] = col[2];
        imgData.data[p + 3] = col[3];
      }
      ctx.putImageData(imgData, 0, 0);
      return c;
    };

    // Apply the background-removal mask as alpha=0 onto an ImageData copy.
    IP.Canvas.applyBackgroundMask = function (imageData, bgMask) {
      var out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      for (var i = 0; i < bgMask.length; i++) {
        if (bgMask[i]) out.data[i * 4 + 3] = 0;
      }
      return out;
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = IP;
  } else {
    root.MI = root.MI || {};
    root.MI.ImageProcessing = IP;
  }
})(typeof window !== 'undefined' ? window : global);
