/*
 * Make It — lazy-loaded 3D preview (Three.js). Only loaded when a 3D-print
 * mode is active. Shows the model on a small print-bed grid with hand-written
 * orbit/zoom/pan controls (no extra dependency beyond three.min.js).
 */
(function (root) {
  'use strict';

  var Preview3D = {};
  var threeLoadPromise = null;

  Preview3D.ensureLoaded = function () {
    if (window.THREE) return Promise.resolve();
    if (threeLoadPromise) return threeLoadPromise;
    threeLoadPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/lib/three.min.js';
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load the 3D preview engine.')); };
      document.head.appendChild(s);
    });
    return threeLoadPromise;
  };

  // Creates a preview instance bound to a container element.
  Preview3D.create = function (container) {
    var THREE = window.THREE;
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f4f6);

    var camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    var renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.1));
    var dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(80, 120, 160);
    scene.add(dir);

    var bedGroup = new THREE.Group();
    scene.add(bedGroup);

    var modelGroup = new THREE.Group();
    scene.add(modelGroup);

    var target = new THREE.Vector3(0, 0, 0);
    var spherical = { radius: 200, theta: Math.PI / 4, phi: Math.PI / 3 };
    var homeSpherical = null;

    function updateCamera() {
      var sinPhiRadius = spherical.radius * Math.sin(spherical.phi);
      camera.position.x = target.x + sinPhiRadius * Math.sin(spherical.theta);
      camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
      camera.position.z = target.z + sinPhiRadius * Math.cos(spherical.theta);
      camera.lookAt(target);
    }

    // --- hand-written orbit/zoom/pan controls ---
    var dom = renderer.domElement;
    dom.style.touchAction = 'none';
    var dragging = false, panning = false;
    var lastX = 0, lastY = 0;
    var pinchStartDist = 0, pinchStartRadius = 0;

    dom.addEventListener('pointerdown', function (e) {
      dom.setPointerCapture(e.pointerId);
      lastX = e.clientX; lastY = e.clientY;
      if (e.button === 2 || e.shiftKey) panning = true; else dragging = true;
    });
    dom.addEventListener('pointerup', function () { dragging = false; panning = false; });
    dom.addEventListener('pointercancel', function () { dragging = false; panning = false; });
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointermove', function (e) {
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      if (dragging) {
        spherical.theta -= dx * 0.008;
        spherical.phi = clamp(spherical.phi - dy * 0.008, 0.05, Math.PI - 0.05);
        updateCamera();
        render();
      } else if (panning) {
        var panSpeed = spherical.radius * 0.0016;
        var right = new THREE.Vector3(Math.cos(spherical.theta), 0, -Math.sin(spherical.theta));
        var up = new THREE.Vector3(0, 1, 0);
        target.addScaledVector(right, -dx * panSpeed);
        target.addScaledVector(up, dy * panSpeed);
        updateCamera();
        render();
      }
    });
    dom.addEventListener('wheel', function (e) {
      e.preventDefault();
      spherical.radius = clamp(spherical.radius * (1 + e.deltaY * 0.001), 20, 2000);
      updateCamera();
      render();
    }, { passive: false });

    // basic touch pinch-to-zoom
    var activeTouches = {};
    dom.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        pinchStartDist = touchDist(e.touches);
        pinchStartRadius = spherical.radius;
      }
    }, { passive: true });
    dom.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2) {
        var d = touchDist(e.touches);
        if (pinchStartDist > 0) {
          spherical.radius = clamp(pinchStartRadius * (pinchStartDist / d), 20, 2000);
          updateCamera();
          render();
        }
      }
    }, { passive: true });

    function touchDist(touches) {
      var dx = touches[0].clientX - touches[1].clientX;
      var dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

    function render() { renderer.render(scene, camera); }

    function resize() {
      var w = container.clientWidth || 300;
      var h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    }
    window.addEventListener('resize', resize);
    resize();
    updateCamera();
    render();

    function disposeGroup(group) {
      group.children.slice().forEach(function (obj) {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach(function (m) { m.dispose(); });
          else obj.material.dispose();
        }
        group.remove(obj);
      });
    }

    // meshes: array of { vertices:[[x,y,z]], triangles:[[i,i,i]], colorHex }
    // bedWidthMm/bedDepthMm: print-bed footprint to draw as a reference grid.
    function setMeshes(meshes, bedWidthMm, bedDepthMm) {
      disposeGroup(modelGroup);
      disposeGroup(bedGroup);

      var bedW = Math.max(bedWidthMm || 200, 40);
      var bedD = Math.max(bedDepthMm || 200, 40);
      var grid = new THREE.GridHelper(Math.max(bedW, bedD) * 1.3, 20, 0xbbbbbb, 0xdddddd);
      bedGroup.add(grid);
      var bedGeo = new THREE.PlaneGeometry(bedW, bedD);
      var bedMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, opacity: 0.35 });
      var bedPlane = new THREE.Mesh(bedGeo, bedMat);
      bedPlane.rotation.x = -Math.PI / 2;
      bedPlane.position.y = -0.05;
      bedGroup.add(bedPlane);

      var maxExtent = 0;
      meshes.forEach(function (m) {
        var geo = new THREE.BufferGeometry();
        var posArr = new Float32Array(m.triangles.length * 9);
        var p = 0;
        m.triangles.forEach(function (t) {
          t.forEach(function (idx) {
            var v = m.vertices[idx];
            posArr[p++] = v[0] - bedW / 2;
            posArr[p++] = v[2]; // model Z (up) -> three.js Y (up)
            posArr[p++] = -(v[1] - bedD / 2); // model Y (depth) -> three.js -Z
          });
        });
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geo.computeVertexNormals();
        var mat = new THREE.MeshStandardMaterial({ color: m.colorHex || 0x3b82f6, roughness: 0.55, metalness: 0.05 });
        var mesh = new THREE.Mesh(geo, mat);
        modelGroup.add(mesh);
        maxExtent = Math.max(maxExtent, bedW, bedD);
      });

      spherical.radius = Math.max(maxExtent * 1.6, 80);
      homeSpherical = { radius: spherical.radius, theta: Math.PI / 4, phi: Math.PI / 3 };
      target.set(0, 0, 0);
      resetCamera();
    }

    function resetCamera() {
      if (homeSpherical) {
        spherical.radius = homeSpherical.radius;
        spherical.theta = homeSpherical.theta;
        spherical.phi = homeSpherical.phi;
      }
      target.set(0, 0, 0);
      updateCamera();
      render();
    }

    function topView() {
      spherical.phi = 0.15;
      updateCamera();
      render();
    }

    function dispose() {
      window.removeEventListener('resize', resize);
      disposeGroup(modelGroup);
      disposeGroup(bedGroup);
      renderer.dispose();
      if (dom.parentNode) dom.parentNode.removeChild(dom);
    }

    return {
      setMeshes: setMeshes,
      resetCamera: resetCamera,
      topView: topView,
      resize: resize,
      dispose: dispose
    };
  };

  window.MI = window.MI || {};
  window.MI.Preview3D = Preview3D;
})(window);
