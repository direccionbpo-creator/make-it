/*
 * Make It — minimal ZIP writer (STORE method, no compression dependency).
 * Enough to build valid .3mf containers without vendoring a deflate library.
 */
(function (root) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function stringToBytes(str) {
    // UTF-8 encode
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.codePointAt(i);
      if (code > 0xFFFF) i++; // consumed a surrogate pair
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code < 0x10000) {
        out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        out.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return new Uint8Array(out);
  }

  function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
  function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }

  // files: array of { name: string, data: Uint8Array | string }
  function buildZip(files) {
    var localChunks = [];
    var centralChunks = [];
    var offset = 0;
    var dosTime = 0, dosDate = 0x21; // arbitrary fixed date, not meaningful here

    files.forEach(function (file) {
      var nameBytes = stringToBytes(file.name);
      var data = typeof file.data === 'string' ? stringToBytes(file.data) : file.data;
      var crc = crc32(data);
      var size = data.length;

      var local = [].concat(
        u32(0x04034b50),
        u16(20), u16(0), u16(0),
        u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0)
      );
      var localHeader = new Uint8Array(local);
      localChunks.push(localHeader, nameBytes, data);

      var central = [].concat(
        u32(0x02014b50),
        u16(20), u16(20), u16(0), u16(0),
        u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size),
        u16(nameBytes.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(offset)
      );
      centralChunks.push(new Uint8Array(central), nameBytes);

      offset += localHeader.length + nameBytes.length + data.length;
    });

    var centralStart = offset;
    var centralSize = 0;
    centralChunks.forEach(function (c) { centralSize += c.length; });

    var eocd = new Uint8Array([].concat(
      u32(0x06054b50),
      u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(centralSize), u32(centralStart),
      u16(0)
    ));

    var totalSize = offset + centralSize + eocd.length;
    var out = new Uint8Array(totalSize);
    var pos = 0;
    function write(chunk) { out.set(chunk, pos); pos += chunk.length; }
    localChunks.forEach(write);
    centralChunks.forEach(write);
    write(eocd);

    return out;
  }

  var ExportZip = { buildZip: buildZip, crc32: crc32, stringToBytes: stringToBytes };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportZip;
  } else {
    root.MI = root.MI || {};
    root.MI.ExportZip = ExportZip;
  }
})(typeof window !== 'undefined' ? window : global);
