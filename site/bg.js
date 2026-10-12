// Cinematic background: flowing energy ribbons above a deforming wireframe landscape.
// Three.js with custom shaders. Fixed behind the page, ignores pointer events.
(function () {
  "use strict";
  var canvas = document.getElementById("bg-canvas");
  if (!canvas || !window.THREE) { return; }

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]still(=|&|$)/.test(location.search);   // ?still forces the calm mode (also used for screenshots)
  var mobile = window.matchMedia("(max-width: 800px)").matches || /Mobi|Android/i.test(navigator.userAgent);
  // weaker machines (few cores / little memory) start with the lighter scene
  var forceLite = /[?&]lite\b/.test(location.search);        // ?lite and ?degrade are for testing weak machines
  var lite = forceLite || mobile || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || (navigator.deviceMemory && navigator.deviceMemory <= 4);

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !lite, alpha: true });
  } catch (e) { return; }               // no WebGL: the CSS gradient behind stays
  var maxDpr = lite ? 1 : 2;             // full sharpness on Retina screens
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
  renderer.setClearColor(0x000000, 0);

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(52, 1, 0.1, 160);
  var rig = { x: 0, y: 0, tx: 0, ty: 0, scroll: 0 };

  var uTime = { value: 0 };
  var uScroll = { value: 0 };           // 0..1 position on the page, smoothed
  var uVel = { value: 0 };              // how fast the page is being scrolled, smoothed
  var uIntro = { value: reduced ? 1 : 0 };   // 0..1: the scene unfolds when the page opens
  var disposables = [];

  // ---------- wireframe landscape ----------
  var GRID_W = 96, GRID_D = 84, Z0 = -66;
  var nCols = lite ? 56 : 84, nRows = lite ? 44 : 66;
  var colSegs = lite ? 90 : 130, rowSegs = lite ? 70 : 100;
  var gPos = [], gAxis = [], gId = [], gIdx = [];
  function pushLine(pointFn, segs, axis, id) {
    var base = gPos.length / 3;
    for (var i = 0; i <= segs; i++) {
      var p = pointFn(i / segs);
      gPos.push(p[0], 0, p[1]); gAxis.push(axis); gId.push(id);
      if (i > 0) { gIdx.push(base + i - 1, base + i); }
    }
  }
  var c, r;
  for (c = 0; c < nCols; c++) {
    (function (x, id) { pushLine(function (t) { return [x, Z0 + t * GRID_D]; }, colSegs, 0, id); })(-GRID_W / 2 + GRID_W * c / (nCols - 1), Math.random());
  }
  for (r = 0; r < nRows; r++) {
    (function (z, id) { pushLine(function (t) { return [-GRID_W / 2 + t * GRID_W, z]; }, rowSegs, 1, id); })(Z0 + GRID_D * r / (nRows - 1), Math.random());
  }
  var gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(gPos, 3));
  gridGeo.setAttribute("aAxis", new THREE.Float32BufferAttribute(gAxis, 1));
  gridGeo.setAttribute("aId", new THREE.Float32BufferAttribute(gId, 1));
  gridGeo.setIndex(gIdx);

  var gridMat = new THREE.ShaderMaterial({
    uniforms: { uTime: uTime, uScroll: uScroll, uVel: uVel, uIntro: uIntro, uZ0: { value: Z0 }, uDepth: { value: GRID_D } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: [
      "uniform float uTime; uniform float uScroll; uniform float uVel; uniform float uIntro;",
      "attribute float aAxis; attribute float aId;",
      "varying float vH; varying float vAxis; varying float vId; varying vec3 vWorld; varying float vDepth;",
      "float height(float x, float z, float t0) {",
      "  float t = t0 + uScroll * 9.0;",
      "  float h = sin(x * 0.30 + t * 0.30) * 0.9",
      "          + sin(z * 0.24 - t * 0.55 + x * 0.10) * 1.2",
      "          + sin((x + z) * 0.13 + t * 0.20) * 1.7",
      "          + sin(x * 0.7 - z * 0.45 + t * 0.7) * 0.25;",
      "  float side = smoothstep(3.0, 20.0, abs(x));",        // calm lane in the middle, hills on the sides
      "  return h * (0.18 + 0.82 * side) * (1.0 + uScroll * 0.8 + uVel * 0.25) * (0.2 + 0.8 * uIntro);",
      "}",
      "void main() {",
      "  vec3 p = position;",
      "  p.y = height(p.x, p.z, uTime);",
      "  vH = p.y; vAxis = aAxis; vId = aId; vWorld = p;",
      "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
      "  vDepth = -mv.z;",
      "  gl_Position = projectionMatrix * mv;",
      "}"
    ].join("\n"),
    fragmentShader: [
      "uniform float uTime; uniform float uZ0; uniform float uDepth;",
      "varying float vH; varying float vAxis; varying float vId; varying vec3 vWorld; varying float vDepth;",
      "float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }",
      "void main() {",
      "  vec3 blue = vec3(0.10, 0.38, 1.00);",
      "  vec3 col = mix(blue, vec3(0.15, 0.82, 1.0), smoothstep(-1.8, 1.8, vH));",
      "  col = mix(col, vec3(0.82, 0.96, 1.0), smoothstep(2.4, 4.6, vH));",
      "  float fade = exp(-vDepth * 0.020) * smoothstep(1.5, 9.0, vDepth);",
      "  float q = (vWorld.z - uZ0) / uDepth;",
      "  float trail = 0.0;",
      // light trails run along some of the lines that go away from the camera
      "  if (vAxis < 0.5) {",
      "    float on = step(0.78, hash(vId * 3.1));",
      "    float speed = 0.05 + 0.07 * hash(vId * 7.7);",
      "    float d = fract(q + uTime * speed + hash(vId * 11.3));",
      "    trail = on * exp(-d * 16.0) * smoothstep(0.0, 0.03, d);",
      "  } else {",
      // a slow bright wave front sweeps through the rows
      "    float front = fract(uTime * 0.045) * (uDepth + 24.0) + uZ0 - 6.0;",
      "    trail = 0.9 * exp(-abs(vWorld.z - front) * 0.55);",
      "  }",
      "  float base = 0.55 + 0.30 * smoothstep(-1.0, 3.0, vH);",
      "  vec3 lit = col * base + vec3(0.65, 0.85, 1.0) * trail * 1.2 + col * trail * 0.9;",
      "  gl_FragColor = vec4(lit, (base + trail) * fade);",
      "}"
    ].join("\n")
  });
  var grid = new THREE.LineSegments(gridGeo, gridMat);
  grid.position.y = -3.4;
  grid.frustumCulled = false;
  grid.renderOrder = 0;
  scene.add(grid);
  disposables.push(gridGeo, gridMat);

  // ---------- energy ribbons ----------
  var RIB_SEGS = lite ? 840 : 2240;     // dense strips: no per-segment teeth where the ribbon twists
  var U_EXT = 0.2;                      // the path runs this far past both screen edges, so a thread never ends in view
  var pathGlsl = [
    "uniform float uTime; uniform float uSeed; uniform float uScroll; uniform float uVel; uniform float uIntro;",
    "attribute float aU; attribute float aV;",
    "vec3 pathAt(float u, float t) {",
    "  float sc = uScroll * 7.0;",
    "  float x = (u - 0.5) * 40.0 + sin(u * 5.0 + t * 0.22 + uSeed + sc) * 3.2;",
    "  float y = 4.4 - (1.0 - uIntro) * 4.5 + sin(u * 7.0 - t * 0.28 + uSeed * 2.0 - sc * 0.8) * (2.4 + uVel * 0.6) + sin(u * 13.0 + t * 0.17 + uSeed + sc) * 0.6;",
    "  float z = -12.0 + sin(u * 4.0 + t * 0.19 + uSeed * 3.0) * 5.0 + cos(u * 9.0 - t * 0.21 + uSeed) * 1.4;",
    "  return vec3(x, y, z);",
    "}"
  ].join("\n");
  var ribbonVert = [
    pathGlsl,
    "uniform float uWidth;",
    "varying float vU; varying float vV; varying vec3 vN; varying vec3 vView; varying float vSlope;",
    "void main() {",
    "  float t = uTime; float e = 0.004;",
    "  vec3 p = pathAt(aU, t);",
    "  vec3 tang = normalize(pathAt(aU + e, t) - pathAt(aU - e, t));",
    "  float tw = aU * 8.0 + t * 0.33 + uSeed * 5.0 + sin(aU * 3.0 + t * 0.27) * 2.2 + uScroll * 9.0;",
    "  vec3 ref = vec3(0.0, cos(tw), sin(tw));",
    "  vec3 side = normalize(cross(tang, ref));",
    "  vec3 nrm = normalize(cross(tang, side));",
    "  float prof = (0.30 + 0.70 * sin(clamp(aU, 0.0, 1.0) * 3.14159)) * (0.72 + 0.28 * sin(aU * 11.0 + t * 0.5 + uSeed));",
    "  vec3 pos = p + side * aV * uWidth * prof;",
    "  vU = aU; vV = aV;",
    "  vec4 c0 = projectionMatrix * viewMatrix * vec4(pathAt(aU - e, t), 1.0);",
    "  vec4 c1 = projectionMatrix * viewMatrix * vec4(pathAt(aU + e, t), 1.0);",
    "  vSlope = length(c1.xy / c1.w - c0.xy / c0.w) / (2.0 * e);",   // how fast the ribbon moves across the screen; ~0 where it points at the camera
    "  vN = nrm; vView = cameraPosition - pos;",           // the facing term is computed per pixel, not per vertex: no banding
    "  gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);",
    "}"
  ].join("\n");
  var ribbonFrag = [
    "uniform float uTime; uniform float uSeed; uniform float uOpacity; uniform float uPulse; uniform float uScroll; uniform float uVel; uniform float uIntro;",
    "varying float vU; varying float vV; varying vec3 vN; varying vec3 vView; varying float vSlope;",
    "void main() {",
    "  vec3 blue = vec3(0.10, 0.38, 1.00), cyan = vec3(0.12, 0.82, 1.00), indigo = vec3(0.34, 0.32, 1.00);",
    "  float k = fract(vU * 1.1 - uTime * 0.035 + uSeed + uScroll * 0.7) * 3.0;",
    "  vec3 col = k < 1.0 ? mix(blue, cyan, k) : (k < 2.0 ? mix(cyan, indigo, k - 1.0) : mix(indigo, blue, k - 2.0));",
    "  float core = pow(1.0 - abs(vV), 3.5);",
    "  float silk = 0.88 + 0.12 * sin(vV * 7.0 + vU * 18.0 - uTime * 1.3);",   // low frequency: no moire when the ribbon twists
    "  float ends = smoothstep(" + (-U_EXT).toFixed(2) + ", " + (0.06 - U_EXT).toFixed(2) + ", vU) * smoothstep(" + (1 + U_EXT).toFixed(2) + ", " + (0.94 + U_EXT).toFixed(2) + ", vU);",
    "  float vFace = abs(dot(normalize(vN), normalize(vView)));",
    "  float edge = 0.62 + 1.4 * pow(1.0 - vFace, 2.0);",   // brighter when the ribbon turns edge-on
    "  float d = fract(vU - uTime * uPulse - uSeed * 0.37); d = d > 0.5 ? d - 1.0 : d;",
    "  float boost = 1.0 + (1.8 + uVel * 1.2) * exp(-d * d * 220.0);",     // a light travelling along the ribbon
    "  float a = core * silk * ends * edge * uOpacity * uIntro * smoothstep(0.10, 0.40, vFace) * smoothstep(0.25, 1.2, vSlope);",   // edge-on slivers fade out: they only show per-segment combing
    "  gl_FragColor = vec4(col * boost, a);",
    "}"
  ].join("\n");

  // The neon thread: a strip along the same path that always faces the camera,
  // so it never collapses where the ribbon twists and stays one unbroken line.
  var threadVert = [
    pathGlsl,
    "uniform float uThread;",
    "varying float vU; varying float vV;",
    "void main() {",
    "  float t = uTime; float e = 0.004;",
    "  vec3 p = pathAt(aU, t);",
    "  vec3 tang = normalize(pathAt(aU + e, t) - pathAt(aU - e, t));",
    "  vec3 toCam = cameraPosition - p;",
    "  vec3 side = cross(tang, normalize(toCam));",
    "  side = length(side) > 1e-4 ? normalize(side) : vec3(0.0, 1.0, 0.0);",
    "  vU = aU; vV = aV;",
    "  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aV * uThread * length(toCam), 1.0);",   // width grows with distance: about the same on screen everywhere
    "}"
  ].join("\n");
  var threadFrag = [
    "uniform float uTime; uniform float uSeed; uniform float uOpacity; uniform float uPulse; uniform float uScroll; uniform float uVel; uniform float uIntro;",
    "varying float vU; varying float vV;",
    "void main() {",
    "  vec3 blue = vec3(0.10, 0.38, 1.00), cyan = vec3(0.12, 0.82, 1.00), indigo = vec3(0.34, 0.32, 1.00);",
    "  float k = fract(vU * 1.1 - uTime * 0.035 + uSeed + uScroll * 0.7) * 3.0;",
    "  vec3 col = k < 1.0 ? mix(blue, cyan, k) : (k < 2.0 ? mix(cyan, indigo, k - 1.0) : mix(indigo, blue, k - 2.0));",
    "  float ends = smoothstep(" + (-U_EXT).toFixed(2) + ", " + (0.06 - U_EXT).toFixed(2) + ", vU) * smoothstep(" + (1 + U_EXT).toFixed(2) + ", " + (0.94 + U_EXT).toFixed(2) + ", vU);",
    "  float d = fract(vU - uTime * uPulse - uSeed * 0.37); d = d > 0.5 ? d - 1.0 : d;",
    "  float boost = 1.0 + (1.8 + uVel * 1.2) * exp(-d * d * 220.0);",
    "  float v = abs(vV);",
    "  float lw = max(0.16, fwidth(vV) * 1.2);",
    "  float line = exp(-(v * v) / (lw * lw));",                                // thin white core
    "  float glow = exp(-v * 3.2) * (1.0 - smoothstep(0.75, 1.0, v));",        // soft coloured halo that reaches zero at the strip edge
    "  vec3 c = mix(col, vec3(1.0), line * 0.92) * boost;",
    "  gl_FragColor = vec4(c, (line * 0.85 + glow * 0.45) * ends * uOpacity * uIntro);",
    "}"
  ].join("\n");

  var ribbons = [
    { seed: 0.0, width: 1.7, opacity: 1.1, pulse: 0.060 },
    { seed: 1.7, width: 1.1, opacity: 1.3, pulse: 0.045 },
    { seed: 3.3, width: 0.65, opacity: 1.5, pulse: 0.075 },
    { seed: 6.1, width: 0.45, opacity: 1.6, pulse: 0.055 }
  ];
  ribbons.forEach(function (cfg, i) {
    var pos = [], us = [], vs = [], idx = [];
    for (var s = 0; s <= RIB_SEGS; s++) {
      var u = -U_EXT + (1 + 2 * U_EXT) * s / RIB_SEGS;
      pos.push(0, 0, 0, 0, 0, 0); us.push(u, u); vs.push(-1, 1);
      if (s > 0) { var a = (s - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("aU", new THREE.Float32BufferAttribute(us, 1));
    geo.setAttribute("aV", new THREE.Float32BufferAttribute(vs, 1));
    geo.setIndex(idx);
    var mat = new THREE.ShaderMaterial({
      uniforms: { uTime: uTime, uScroll: uScroll, uVel: uVel, uIntro: uIntro, uSeed: { value: cfg.seed }, uWidth: { value: cfg.width }, uOpacity: { value: cfg.opacity }, uPulse: { value: cfg.pulse } },
      vertexShader: ribbonVert, fragmentShader: ribbonFrag,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      extensions: { derivatives: true }       // for fwidth() in the fragment shader
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1 + i;
    scene.add(mesh);
    var threadMat = new THREE.ShaderMaterial({
      uniforms: { uTime: uTime, uScroll: uScroll, uVel: uVel, uIntro: uIntro, uSeed: { value: cfg.seed }, uThread: { value: lite ? 0.0042 : 0.0034 }, uOpacity: { value: Math.min(cfg.opacity, 1.3) }, uPulse: { value: cfg.pulse } },
      vertexShader: threadVert, fragmentShader: threadFrag,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      extensions: { derivatives: true }
    });
    var thread = new THREE.Mesh(geo, threadMat);       // same strip layout (aU along, aV across) as the ribbon
    thread.frustumCulled = false;
    thread.renderOrder = 10 + i;
    scene.add(thread);
    disposables.push(geo, mat, threadMat);
  });

  // ---------- size, input, loop ----------
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 74 : 52;       // wider view on portrait phones
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  if (!reduced) {
    window.addEventListener("pointermove", function (e) {
      rig.tx = e.clientX / window.innerWidth - 0.5;
      rig.ty = e.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }
  var scrollY = window.scrollY, prevY = scrollY, scrollP = 0, velRaw = 0;
  function readScroll() {
    var max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    scrollP = Math.min(Math.max(window.scrollY / max, 0), 1);
  }
  window.addEventListener("scroll", function () { readScroll(); }, { passive: true });
  readScroll();

  var target = new THREE.Vector3();
  function render() {
    rig.x += (rig.tx - rig.x) * 0.04; rig.y += (rig.ty - rig.y) * 0.04;
    var s = uScroll.value;
    // the camera glides forward over the landscape and rises a little as you scroll
    camera.position.set(rig.x * 3.2 + Math.sin(s * 5.0) * 1.6, 1.6 - rig.y * 1.6 + s * 2.2, 9.5 - s * 5.5 + (1.0 - uIntro.value) * 3.5);
    target.set(rig.x * 1.2 + Math.sin(s * 3.0) * 2.0, 2.6 - rig.y * 0.8 + s * 1.2, -14);
    camera.lookAt(target);
    camera.rotation.z += Math.sin(s * 4.0) * 0.05 + uVel.value * 0.004;
    renderer.render(scene, camera);
  }

  var raf = 0, last = performance.now(), running = true;
  var govLimit = /[?&]degrade\b/.test(location.search) ? 0 : 0.045;  // seconds per frame that count as too slow (~22 fps; Safari's 30 fps power-saving cap is not "slow")
  var introT = 0, gov = { n: 0, sum: 0, stage: 0 }, halfRate = false, tick = 0;
  function degrade() {                    // stage 1: draw fewer pixels, stage 2: draw every other frame
    gov.stage++;
    canvas.dataset.quality = String(gov.stage);          // 0 full, 1 fewer pixels, 2 half frame rate
    if (gov.stage === 1) { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 0.75 : 1.25)); resize(); } else { halfRate = true; }   // desktops keep at least 1.25: 0.75 looked pixelated on Retina
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (halfRate && (tick++ & 1)) { return; }
    var rawDt = (now - last) / 1000; last = now;
    var dt = Math.min(rawDt, 0.1);
    if (introT < 1) { introT = Math.min(introT + dt / 2.6, 1); uIntro.value = 1 - Math.pow(1 - introT, 3); }
    else if (gov.stage < 2 && rawDt < 0.25) { // measure after the intro; slow machines get a lighter render (stalls of a background window do not count)
      gov.n++; gov.sum += dt;
      if (gov.n === 90) { if (gov.sum / 90 > govLimit) { degrade(); } gov.n = 0; gov.sum = 0; }
    }
    scrollY = window.scrollY;
    velRaw = Math.min(Math.abs(scrollY - prevY) / Math.max(dt * 1000, 8) * 0.9, 4); prevY = scrollY;
    uVel.value += (velRaw - uVel.value) * 0.08;
    uScroll.value += (scrollP - uScroll.value) * 0.05;
    uTime.value += dt * (1 + uVel.value * 1.4);
    render();
  }
  function start() { if (!raf && running) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

  if (reduced) {
    uTime.value = 14.0;                 // one calm, still frame; it still follows the scroll position
    uScroll.value = scrollP; render();
    window.addEventListener("scroll", function () { uScroll.value = scrollP; render(); }, { passive: true });
    window.addEventListener("resize", render);
  } else {
    start();
    document.addEventListener("visibilitychange", function () { document.hidden ? stop() : start(); });
  }
  canvas.dataset.quality = "0";
  canvas.classList.add("ready");

  window.addEventListener("pagehide", function () {
    running = false; stop();
    disposables.forEach(function (d) { d.dispose(); });
    renderer.dispose();
  });
})();
