// photo-to-3d site: 3D viewers, scroll-driven animation and small effects.
// Only dependency: three.js (vendor/). The background lives in bg.js.
(function () {
  "use strict";
  document.documentElement.classList.add("js");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches || /[?&]still(=|&|$)/.test(location.search);   // ?still forces the calm mode (also used for screenshots)
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };

  // ---------- model data (assets/meta.json), with safe defaults ----------
  var META = {
    hero: { bin: "assets/scarecrow.bin", name: "model_120mm.stl", height: 120, size: "", pla: "", contact: "", time: "~2 min", ram: "" },
    steps: { bin: "assets/steps.bin" },
    v1: { bin: "assets/compare-fast.bin" },
    v2: { bin: "assets/scarecrow.bin" }
  };

  // ---------- reveal on scroll (with stagger inside a group) ----------
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) { entry.target.classList.add("in"); revealObserver.unobserve(entry.target); }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach(function (el) {
    var siblings = el.parentElement.querySelectorAll(":scope > .reveal");
    var base = el.closest(".hero-text") && !reduced ? 0.45 : 0;        // the hero text waits for the background intro
    el.style.setProperty("--d", (base + Math.min(Array.prototype.indexOf.call(siblings, el), 5) * 0.12).toFixed(2) + "s");
    revealObserver.observe(el);
  });

  // ---------- count up ----------
  var countObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) { return; }
      countObserver.unobserve(entry.target);
      var el = entry.target;
      var to = parseFloat(el.dataset.to), dec = parseInt(el.dataset.dec || "0", 10), prefix = el.dataset.prefix || "";
      if (reduced || to === 0) { el.textContent = prefix + to.toFixed(dec); return; }
      var start = performance.now();
      (function tick(now) {
        var t = Math.min((now - start) / 1400, 1), e = 1 - Math.pow(1 - t, 3);
        el.textContent = prefix + (to * e).toFixed(dec);
        if (t < 1) { requestAnimationFrame(tick); }
      })(start);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".count").forEach(function (el) { countObserver.observe(el); });

  // ---------- scroll-driven animation ----------
  var bar = document.querySelector(".progress span");
  var steps = Array.prototype.slice.call(document.querySelectorAll("[data-scroll-step]"));
  var parallax = Array.prototype.slice.call(document.querySelectorAll("[data-parallax]"));
  var arrows = Array.prototype.slice.call(document.querySelectorAll(".step-arrow span"));
  var shifts = [-1, 0, 1];
  steps.forEach(function (el, i) {
    var s = el.dataset.shift !== undefined ? parseFloat(el.dataset.shift) : shifts[i % 3];
    el.style.setProperty("--sx", s);
    el._p = reduced ? 1 : 0;
  });
  var scrollHooks = [];            // viewers register here to react to scrolling
  var lastY = window.scrollY, ticking = false;

  function updateScroll() {
    ticking = false;
    var y = window.scrollY, dy = y - lastY; lastY = y;
    var vh = window.innerHeight, max = document.documentElement.scrollHeight - vh;
    bar.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    var settling = false;
    steps.forEach(function (el) {
      var r = el.getBoundingClientRect();
      var target = reduced ? 1 : clamp((vh * 0.96 - r.top) / (vh * 0.5), 0, 1);
      el._p += (target - el._p) * 0.18;
      if (Math.abs(target - el._p) > 0.003) { settling = true; } else { el._p = target; }
      el.style.setProperty("--p", el._p.toFixed(3));
    });
    arrows.forEach(function (a, i) {
      var left = steps[i], right = steps[i + 1];
      if (left && right) { a.style.setProperty("--ap", (0.25 + 0.75 * Math.min(left._p, right._p)).toFixed(3)); }
    });
    if (!reduced) {
      parallax.forEach(function (el) {
        var r = el.getBoundingClientRect();
        var off = (r.top + r.height / 2 - vh / 2) * -parseFloat(el.dataset.parallax);
        el.style.setProperty("--py", off.toFixed(1) + "px");
      });
    }
    scrollHooks.forEach(function (fn) { fn(dy, y, max); });
    if (settling) { schedule(); }
  }
  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(updateScroll); } }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  updateScroll();

  // ---------- nav: smaller after scrolling, pill under the current section ----------
  var nav = document.querySelector(".nav");
  var pill = document.querySelector(".nav-pill");
  var navLinks = Array.prototype.slice.call(document.querySelectorAll(".nav-links a"));
  var current = null, hovered = null;

  function placePill() {
    var link = hovered || current;
    if (!link) { pill.classList.remove("on"); return; }
    pill.style.setProperty("--pill-x", link.offsetLeft + "px");
    pill.style.setProperty("--pill-w", link.offsetWidth + "px");
    pill.classList.add("on");
  }
  function updateNav(dy, y) {
    nav.classList.toggle("scrolled", y > 40);
    var mark = window.innerHeight * 0.4, found = null;
    navLinks.forEach(function (link) {
      var section = document.querySelector(link.getAttribute("href"));
      if (section) {
        var r = section.getBoundingClientRect();
        if (r.top <= mark && r.bottom > mark) { found = link; }
      }
    });
    if (found !== current) {
      if (current) { current.classList.remove("active"); }
      current = found;
      if (current) { current.classList.add("active"); }
      placePill();
    }
  }
  navLinks.forEach(function (link) {
    link.addEventListener("mouseenter", function () { hovered = link; placePill(); });
    link.addEventListener("mouseleave", function () { hovered = null; placePill(); });
  });
  scrollHooks.push(updateNav);
  updateNav(0, window.scrollY);

  document.querySelectorAll(".scan").forEach(function (m) {
    var setH = function () { m.style.setProperty("--scan-h", (m.clientHeight - 3) + "px"); };
    setH(); new ResizeObserver(setH).observe(m);
  });

  // ---------- terminal typing ----------
  var term = document.querySelector("#term code");
  function reportLines(m) {
    return [
      '<span class="p">$</span> photo3d make ' + m.name.replace(/_\d+mm\.stl$/, "") + '.png --height ' + m.height + (m.quality ? ' --quality ' + m.quality : ''),
      '<span class="k">engine     :</span> triposg on mps',
      '<span class="k">watertight :</span> <span class="ok">yes</span>   <span class="k">parts :</span> 1',
      '<span class="k">size       :</span> <span class="hl">' + m.size + '</span> mm',
      '<span class="k">PLA (est.) :</span> ' + m.pla,
      '<span class="k">bed contact:</span> ' + m.contact,
      '<span class="k">time       :</span> ' + m.time + (m.ram ? '   <span class="k">peak RAM :</span> ' + m.ram : ''),
      '<span class="ok">done</span> <span class="k">out/' + m.name.replace(/_\d+mm\.stl$/, "") + '/' + m.name + '</span>'
    ];
  }
  function typed(html, n) {                    // cut a highlighted line to n visible characters
    var out = "", seen = 0, inTag = false;
    for (var i = 0; i < html.length && seen < n; i++) {
      var c = html[i]; if (c === "<") { inTag = true; }
      out += c;
      if (c === ">") { inTag = false; } else if (!inTag) { seen++; }
    }
    return out;
  }
  function startTerminal() {
    var lines = reportLines(META.hero);
    var obs = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) { return; }
      obs.disconnect();
      if (reduced) { term.innerHTML = lines.join("\n"); return; }
      var i = 0, html = "";
      (function next() {
        if (i >= lines.length) { term.innerHTML = html + '<span class="caret"></span>'; return; }
        var line = lines[i++], plain = line.replace(/<[^>]+>/g, ""), n = 0;
        if (i === 1) {
          (function type() {
            n += 2;
            term.innerHTML = html + typed(line, n) + '<span class="caret"></span>';
            if (n < plain.length) { setTimeout(type, 28); } else { html += line + "\n"; setTimeout(next, 500); }
          })();
        } else { html += line + "\n"; term.innerHTML = html + '<span class="caret"></span>'; setTimeout(next, 170); }
      })();
    }, { threshold: 0.5 });
    if (term) { obs.observe(term); }
  }

  // ---------- 3D viewers ----------
  if (!window.THREE) { fetchMeta(function () { startTerminal(); }); return; }

  function loadBin(url) {
    return fetch(url).then(function (r) { if (!r.ok) { throw new Error(url); } return r.arrayBuffer(); }).then(function (buf) {
      var head = new Uint32Array(buf, 0, 2), nv = head[0], nf = head[1];
      var pos = new Float32Array(buf, 8, nv * 3), idx = new Uint32Array(buf, 8 + nv * 12, nf * 3);
      var g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      g.computeBoundingBox();
      return g;
    });
  }
  function fetchMeta(done) {
    fetch("assets/meta.json").then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (m) {
      Object.keys(m).forEach(function (k) { META[k] = Object.assign(META[k] || {}, m[k]); });
      done();
    });
  }

  function makeViewer(canvas, geometry, opts) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.localClippingEnabled = true;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20);

    scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x10141c, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(2, 3, 3); scene.add(key);
    var rimA = new THREE.PointLight(0x4f8cff, 2.0, 8); rimA.position.set(-2, 1, -1.5); scene.add(rimA);
    var rimB = new THREE.PointLight(0x28d7e8, 1.6, 8); rimB.position.set(2, 0.4, -2); scene.add(rimB);

    var clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), opts.startFull ? 2 : 0);
    var uniforms = { uLayers: { value: 0 }, uCount: { value: 140 } };
    var material = new THREE.MeshStandardMaterial({ color: 0xa4abc0, roughness: 0.5, metalness: 0.12, clippingPlanes: [clip] });
    material.onBeforeCompile = function (shader) {
      shader.uniforms.uLayers = uniforms.uLayers; shader.uniforms.uCount = uniforms.uCount;
      shader.vertexShader = "varying float vWY;\n" + shader.vertexShader.replace("#include <begin_vertex>",
        "#include <begin_vertex>\n vWY = (modelMatrix * vec4(transformed, 1.0)).y;");
      shader.fragmentShader = "varying float vWY; uniform float uLayers; uniform float uCount;\n" + shader.fragmentShader.replace("#include <color_fragment>",
        "#include <color_fragment>\n if (uLayers > 0.5) { float l = abs(fract(vWY * uCount) - 0.5) * 2.0; diffuseColor.rgb *= 0.62 + 0.38 * smoothstep(0.0, 0.7, l); }");
    };
    var wireMat = new THREE.MeshBasicMaterial({ color: 0x28d7e8, wireframe: true, transparent: true, opacity: 0.28, clippingPlanes: [clip] });

    var holder = new THREE.Group();
    var mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2;      // STL is z-up
    var wire = new THREE.Mesh(geometry, wireMat); wire.rotation.x = -Math.PI / 2;
    wire.visible = !!opts.wireOnly; mesh.visible = !opts.wireOnly;
    holder.add(mesh, wire); scene.add(holder);

    var bb = geometry.boundingBox, sx = bb.max.x - bb.min.x, sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
    var radius = 0.62 * Math.max(sx, sy);
    var ring = new THREE.Mesh(new THREE.RingGeometry(0.982, 1, 160), new THREE.MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.scale.setScalar(radius); scene.add(ring);

    var sc = document.createElement("canvas"); sc.width = sc.height = 128;
    var sctx = sc.getContext("2d"), sg = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    sg.addColorStop(0, "rgba(79,140,255,0.5)"); sg.addColorStop(1, "rgba(79,140,255,0)");
    sctx.fillStyle = sg; sctx.fillRect(0, 0, 128, 128);
    var shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.002; scene.add(shadow);

    var state = opts.shared || { yaw: 0.6, vel: 0.004, dragging: false, last: 0, py: 0, stamp: -1 };
    var local = { building: false, t0: 0, visible: true };
    var onState = opts.onState || function () {};

    var fit = Math.max(1, 1.2 * Math.max(sx, sy));                   // wide models need more room
    var lift = 0.1 + (1 - sz) * 0.5;                                  // flat models are seen from higher up
    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) { return; }
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      var dist = (w / h < 0.9 ? 3.1 : 2.55) * fit;
      camera.position.set(0, sz * 0.5 + lift, dist); camera.lookAt(0, sz * 0.5, 0);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(canvas);
    resize();

    if (opts.interactive) {
      var stage = canvas.parentElement;
      stage.addEventListener("pointerdown", function (e) { state.dragging = true; state.last = e.clientX; stage.setPointerCapture(e.pointerId); });
      stage.addEventListener("pointermove", function (e) {
        state.py = e.clientY / window.innerHeight - 0.5;
        if (!state.dragging) { return; }
        var dx = e.clientX - state.last; state.last = e.clientX;
        state.yaw += dx * 0.011; state.vel = dx * 0.0011;
      });
      var up = function () { state.dragging = false; };
      stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
    }

    new IntersectionObserver(function (e) { local.visible = e[0].isIntersecting; }, { threshold: 0.05 }).observe(canvas);
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function startBuild() {
      if (reduced) { clip.constant = 2; return; }
      if (window.performance && performance.mark) { performance.mark("model-build-start"); }
      local.building = true; local.t0 = performance.now(); onState("build", 0);
    }

    function frame(now) {
      requestAnimationFrame(frame);
      if (!local.visible || document.hidden) { return; }
      if (state.stamp !== now) {                      // viewers sharing one state advance it once per frame
        state.stamp = now;
        if (!state.dragging) {
          state.yaw += state.vel;
          state.vel += ((reduced ? 0 : (opts.speed || 0.0045)) - state.vel) * 0.03;
        }
      }
      holder.rotation.y = state.yaw + (opts.yawOffset || 0);
      holder.rotation.x = opts.interactive ? state.py * 0.25 : 0;
      ring.rotation.z = state.yaw * 2;
      if (local.building) {
        var t = Math.min((now - local.t0) / 1900, 1), h = ease(t);
        clip.constant = h * sz * 1.02;
        ring.position.y = h * sz * 1.02;
        ring.material.opacity = t < 1 ? 1 : 0;
        onState("build", Math.round(h * 400));
        if (t >= 1) { local.building = false; clip.constant = 2; ring.material.opacity = 0; onState("done"); }
      }
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    return {
      build: startBuild,
      nudge: function (d) { if (!reduced && !state.dragging) { state.yaw += d; } },
      setMode: function (m) { mesh.visible = m !== "wire"; wire.visible = m === "wire"; uniforms.uLayers.value = m === "layers" ? 1 : 0; }
    };
  }

  // The hero window opens diagonally (CSS), and only then the model is "printed".
  var card = document.querySelector(".hero-viewer .viewer-card");
  var windowOpen = new Promise(function (resolve) {
    var done = false;
    function opened() {
      if (done) { return; }
      done = true;
      if (card) { card.classList.add("open"); }
      if (window.performance && performance.mark) { performance.mark("window-open"); }
      resolve();
    }
    if (!card || reduced) { opened(); return; }
    card.addEventListener("animationend", function (e) { if (e.animationName === "window-open") { opened(); } });
    setTimeout(opened, 4000);                 // safety net if the animation event never comes
  });

  fetchMeta(function () {
    startTerminal();
    var hero = META.hero;
    document.getElementById("hero-title").textContent = hero.name;
    document.getElementById("hud-dims").textContent = hero.size ? hero.size + " mm" : "";

    loadBin(hero.bin).then(function (geometry) {
      var hudLayer = document.getElementById("hud-layer"), viewerState = document.getElementById("viewer-state");
      var viewer = makeViewer(document.getElementById("hero-canvas"), geometry, {
        interactive: true, startFull: reduced,
        onState: function (kind, layer) {
          if (kind === "build") { hudLayer.classList.add("busy"); hudLayer.textContent = "layer " + layer + " / 400"; viewerState.textContent = "building"; }
          else { hudLayer.classList.remove("busy"); hudLayer.textContent = "watertight ✓"; viewerState.textContent = "ready"; }
        }
      });
      scrollHooks.push(function (dy) { viewer.nudge(dy * 0.006); });   // the model turns as you scroll
      windowOpen.then(function () { setTimeout(viewer.build, reduced ? 0 : 150); });   // right after the window has opened
      document.getElementById("replay").addEventListener("click", viewer.build);
      document.querySelectorAll(".seg button").forEach(function (b) {
        b.addEventListener("click", function () {
          document.querySelectorAll(".seg button").forEach(function (o) { o.classList.toggle("active", o === b); });
          viewer.setMode(b.dataset.mode);
        });
      });
    }).catch(function () { document.querySelector(".hud-bl").textContent = "3D preview unavailable"; });

    loadBin(META.steps.bin).then(function (g) {
      var mini = makeViewer(document.getElementById("mini-canvas"), g, { wireOnly: true, startFull: true, speed: 0.008 });
      scrollHooks.push(function (dy) { mini.nudge(dy * 0.004); });
    }).catch(function () {});

    var shared = { yaw: 3.3, vel: 0.004, dragging: false, last: 0, py: 0, stamp: -1 };
    [["v1-canvas", META.v1.bin, "v1"], ["v2-canvas", META.v2.bin, "v2"]].forEach(function (pair) {
      loadBin(pair[1]).then(function (g) {
        var v = makeViewer(document.getElementById(pair[0]), g, { interactive: true, startFull: true, shared: shared, speed: 0.004, yawOffset: META[pair[2]].yaw || 0 });
        scrollHooks.push(function (dy) { if (pair[0] === "v1-canvas") { v.nudge(dy * 0.004); } });
      }).catch(function () {});
    });
  });
})();
