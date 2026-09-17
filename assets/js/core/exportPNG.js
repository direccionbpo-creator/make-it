/*
 * Make It — PNG export helpers for laser engraving (grayscale / dithered).
 */
(function (root) {
  'use strict';

  var ExportPNG = {};

  // Floyd-Steinberg error-diffusion dithering: grayscale -> pure black/white.
  // gray: Uint8Array/Uint8ClampedArray, values 0-255. Returns Uint8Array (0 or 255).
  function ditherFloydSteinberg(gray, w, h) {
    var buf = new Float32Array(gray.length);
    for (var i = 0; i < gray.length; i++) buf[i] = gray[i];
    var out = new Uint8Array(gray.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var idx = y * w + x;
        var old = buf[idx];
        var newVal = old < 128 ? 0 : 255;
        out[idx] = newVal;
        var err = old - newVal;
        addErr(buf, w, h, x + 1, y, err * 7 / 16);
        addErr(buf, w, h, x - 1, y + 1, err * 3 / 16);
        addErr(buf, w, h, x, y + 1, err * 5 / 16);
        addErr(buf, w, h, x + 1, y + 1, err * 1 / 16);
      }
    }
    return out;
  }

  function addErr(buf, w, h, x, y, val) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    buf[y * w + x] += val;
  }

  ExportPNG.ditherFloydSteinberg = ditherFloydSteinberg;

  if (typeof document !== 'undefined') {
    // grayOrBinary: Uint8Array of gray/binary values 0-255. Returns a canvas.
    ExportPNG.toCanvas = function (values, w, h) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      var imgData = ctx.createImageData(w, h);
      for (var i = 0, p = 0; i < values.length; i++, p += 4) {
        imgData.data[p] = imgData.data[p + 1] = imgData.data[p + 2] = values[i];
        imgData.data[p + 3] = 255;
      }
      ctx.putImageData(imgData, 0, 0);
      return c;
    };

    ExportPNG.canvasToBlob = function (canvas) {
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob); }, 'image/png');
      });
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportPNG;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportPNG = ExportPNG;
  }
})(typeof window !== 'undefined' ? window : global);
