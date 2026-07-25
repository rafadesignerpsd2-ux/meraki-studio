/* ============================================================
   MERAKI STUDIO — MAIN JS
   ============================================================ */

// ── Smooth scroll for anchor links ──────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// ── Testimonials carousel ────────────────────────────────────
(function () {
  const slides = Array.from(document.querySelectorAll('.testimonial-slide'));
  const prevBtns = document.querySelectorAll('.testimonials__nav-btn--prev');
  const nextBtns = document.querySelectorAll('.testimonials__nav-btn--next');
  if (!slides.length || !prevBtns.length || !nextBtns.length) return;

  let current = 0;

  function goTo(index) {
    slides[current].setAttribute('aria-hidden', 'true');
    current = (index + slides.length) % slides.length;
    slides[current].setAttribute('aria-hidden', 'false');
  }

  prevBtns.forEach(btn => btn.addEventListener('click', () => goTo(current - 1)));
  nextBtns.forEach(btn => btn.addEventListener('click', () => goTo(current + 1)));

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    const section = document.getElementById('depoimentos');
    if (!section) return;
    const rect = section.getBoundingClientRect();
    const inView = rect.top < window.innerHeight && rect.bottom > 0;
    if (!inView) return;
    if (e.key === 'ArrowLeft') goTo(current - 1);
    if (e.key === 'ArrowRight') goTo(current + 1);
  });
})();

// ── WebGL Shader: Dispersion Bands ──────────────────────────
(function () {
  function initShader(canvasId, speedMultiplier, seedVal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      console.warn('WebGL2 não suportado');
      return;
    }

  const vertSrc = `#version 300 es
precision highp float;
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

  const fragSrc = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2  u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_seed;
uniform float u_ephemeralAmp;
uniform float u_lensScale;
uniform float u_lensSpacingX;
uniform float u_lensSpacingY;
uniform float u_lensRadius;
uniform float u_dispersionStrength;
uniform float u_edgeDisp;
uniform vec4  u_colors[8];
uniform int   u_colors_length;

const int SAMPLES = 8;
const float EPHEMERAL_DRIP = 1.0;

// === PCG hash - https://www.jcgt.org/published/0009/03/02/
uvec3 hash3(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}
uvec3 seed;
vec3 random3f() {
    seed = hash3(seed);
    return vec3(seed) / float(-1u);
}

vec3 seedRandom(float seedVal) {
    uvec3 s = uvec3(
        floatBitsToUint(seedVal),
        floatBitsToUint(seedVal * 1.5 + 7.31),
        floatBitsToUint(seedVal * 2.7 + 13.37)
    );
    s = hash3(s);
    return vec3(s) / float(0xFFFFFFFFu);
}

// === PALETTE SAMPLING ===
vec3 getColor(int idx) {
    if (u_colors_length < 1) return vec3(0.0);
    int safeIdx = clamp(idx, 0, u_colors_length - 1);
    return u_colors[safeIdx].rgb;
}

vec3 paletteN(float t, int count) {
    if (count < 1) return vec3(0.0);
    if (count < 2) return getColor(0);
    t = clamp(t, 0.0, 1.0) * float(count - 1);
    int idx = min(int(floor(t)), count - 2);
    float localT = fract(t);
    localT = localT * localT * (3.0 - 2.0 * localT);
    return mix(getColor(idx), getColor(idx + 1), localT);
}

// === Gradient Flow ===
float getGradientT(vec2 uv, float t, vec3 s1, vec3 s2) {
    float angle1 = s1.x * 6.28;
    float angle2 = s1.y * 6.28;
    vec2 dir1 = vec2(cos(angle1), sin(angle1));
    vec2 dir2 = vec2(cos(angle2), sin(angle2));

    float freq1 = 1.0 + s1.z * 2.0;
    float freq2 = 1.0 + s2.x * 1.5;
    float freq3 = 1.5 + s2.y * 2.0;

    float flow = dot(uv, dir1) + sin(dot(uv, dir2) * freq1 + t) * 0.3 + t * 0.2;
    float flow2 = dot(uv, dir2.yx) + cos(dot(uv, dir1.yx) * freq2 - t * 0.8) * 0.25;

    float gradT = sin(flow * 1.5) * 0.5 + 0.5;
    gradT += cos(flow2 * 1.2) * 1.3;
    gradT += sin(dot(uv, dir1 + dir2) * freq3 + t * 3.5) * 1.2;
    return smoothstep(0.0, 4.12, gradT);
}

// === BAND LENS ===
void applyBandLens(vec2 pp, float radiusSq, float iorOffset, out vec2 warpedUV, out float edgeFactor) {
    vec2 ppLens = pp;
    float spacingX = max(u_lensSpacingX, 0.001);
    float spacingY = max(u_lensSpacingY, 0.001);
    ppLens.x = fract(pp.x / spacingX + 0.5) * spacingX - spacingX * 0.5;
    ppLens.y = fract(pp.y / spacingY + 0.5) * spacingY - spacingY * 0.5;

    float sp = radiusSq - ppLens.x * ppLens.x - ppLens.y * ppLens.y;

    float lensAmount = smoothstep(-0.1, 0.05, sp);
    float baseLens = sqrt(max(sp, -sp * 0.1) / 0.3);
    edgeFactor = (1.0 - smoothstep(0.0, radiusSq, sp)) * lensAmount;

    float warpAmount = mix(1.0, baseLens * (1.0 + iorOffset), lensAmount);

    warpedUV = pp;
    warpedUV.x += (ppLens.x * warpAmount - ppLens.x);
    warpedUV.y *= warpAmount;
}

void main() {
    vec2 fragCoord = v_uv * u_resolution;
    seed = uvec3(uvec2(fragCoord), uint(fract(u_time) * 1000.0));

    vec2 r = u_resolution;
    vec2 p = (fragCoord * 2.0 - r) / r.y;
    float t = u_time * u_speed;

    int colorCount = u_colors_length;

    if (colorCount < 1) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    vec3 seedOff1 = seedRandom(u_seed);
    vec3 seedOff2 = seedRandom(u_seed + 100.0);

    float dice = random3f().x;

    float radiusSq = u_lensRadius * u_lensRadius;
    vec3 iorOffsets = vec3(-1.0, 0.0, 1.0) * u_dispersionStrength;

    vec3 col = vec3(0.0);

    for (int i = 0; i < SAMPLES; i++) {
        float ephemeral = (float(i) + dice) / float(SAMPLES);
        float sqEph = ephemeral * ephemeral;

        vec2 pt = p;
        pt.x += u_ephemeralAmp * sqEph * sin(p.y * 2.0 + t);
        pt.y += u_ephemeralAmp * sqEph * cos(p.x * 1.5 - t) * 0.5;
        pt.y -= (1.0 - exp(-EPHEMERAL_DRIP * sqEph)) * abs(pt.y) * sign(pt.y) * 0.3;

        vec3 tint = smoothstep(1.0, 0.0, abs(3.0 * ephemeral - vec3(1.0, 1.5, 2.0)));

        vec3 gradTs = vec3(0.0);
        vec3 edgeFactors = vec3(0.0);

        for (int c = 0; c < 3; c++) {
            vec2 pp = pt * u_lensScale;
            vec2 warpedUV;
            float edgeFactor;
            applyBandLens(pp, radiusSq, iorOffsets[c], warpedUV, edgeFactor);

            vec2 gradUV = warpedUV / u_lensScale;
            gradTs[c] = getGradientT(gradUV, t * 0.8, seedOff1, seedOff2);
            edgeFactors[c] = edgeFactor;
        }

        vec3 convergentColor = paletteN(gradTs.g, colorCount);
        float edgeMix = max(max(edgeFactors.r, edgeFactors.g), edgeFactors.b);

        vec3 dispersedColor = vec3(
        float fi = float(i) / float(SAMPLES - 1);
        float dispersionOffset = (fi - 0.5) * u_dispersionStrength;

        vec2 distortedSt = lensDistort(st, center, u_lensRadius, u_lensScale + dispersionOffset, idx);

        float edgeDist = length(distortedSt - center);
        float pattern = sin(edgeDist * u_edgeDisp - u_time * u_speed * 2.0) * 0.5 + 0.5;

        pattern += (fi - 0.5) * 0.1;
        pattern = clamp(pattern, 0.0, 1.0);

        vec4 col = samplePalette(pattern);

        float weight = 1.0 - abs(fi - 0.5) * 0.5;
        accumColor += col * weight;
        totalWeight += weight;
    }

    vec4 finalColor = accumColor / totalWeight;

    vec3 jitter = pcg3d(vec3(gl_FragCoord.xy, u_time)) - 0.5;
    finalColor.rgb += jitter * (1.0 / 255.0);

    fragColor = finalColor;
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(s));
      throw new Error('shader compile error');
    }
    return s;
  }

  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.useProgram(program);

  const quad = new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const loc = {
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    time: gl.getUniformLocation(program, 'u_time'),
    speed: gl.getUniformLocation(program, 'u_speed'),
    seed: gl.getUniformLocation(program, 'u_seed'),
    ephemeralAmp: gl.getUniformLocation(program, 'u_ephemeralAmp'),
    lensScale: gl.getUniformLocation(program, 'u_lensScale'),
    lensSpacingX: gl.getUniformLocation(program, 'u_lensSpacingX'),
    lensSpacingY: gl.getUniformLocation(program, 'u_lensSpacingY'),
    lensRadius: gl.getUniformLocation(program, 'u_lensRadius'),
    dispersionStrength: gl.getUniformLocation(program, 'u_dispersionStrength'),
    edgeDisp: gl.getUniformLocation(program, 'u_edgeDisp'),
    colors: gl.getUniformLocation(program, 'u_colors'),
    colorsLength: gl.getUniformLocation(program, 'u_colors_length'),
  };

  const CONFIG = {
    speed: 0.3,
    seed: 210,
    ephemeralAmp: 0,
    lensScale: 3.5,
    lensSpacingX: 1,
    lensSpacingY: 0.01,
    lensRadius: 0.58,
    dispersionStrength: 0,
    edgeDisp: 2,
    colors: ["#0a0a0b","#4598e5","#ebf5ff"]
  };

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255];
  }

  // Precompute flat colors array once to avoid allocations per frame
  const flatColors = new Float32Array(8 * 4);
  CONFIG.colors.forEach((hex, i) => {
    const [r,g,b] = hexToRgb(hex);
    flatColors[i*4] = r; flatColors[i*4+1] = g; flatColors[i*4+2] = b; flatColors[i*4+3] = 1.0;
  });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();

  const start = performance.now();
  let isVisible = true;
  let animId = null;

  function render() {
    if (!isVisible || document.hidden) {
      animId = null;
      return;
    }

    const t = (performance.now() - start) / 1000;

    gl.uniform2f(loc.resolution, canvas.width, canvas.height);
    gl.uniform1f(loc.time, t);
    gl.uniform1f(loc.speed, CONFIG.speed * speedMultiplier);
    gl.uniform1f(loc.seed, seedVal);
    gl.uniform1f(loc.ephemeralAmp, CONFIG.ephemeralAmp);
    gl.uniform1f(loc.lensScale, CONFIG.lensScale);
    gl.uniform1f(loc.lensSpacingX, CONFIG.lensSpacingX);
    gl.uniform1f(loc.lensSpacingY, CONFIG.lensSpacingY);
    gl.uniform1f(loc.lensRadius, CONFIG.lensRadius);
    gl.uniform1f(loc.dispersionStrength, CONFIG.dispersionStrength);
    gl.uniform1f(loc.edgeDisp, CONFIG.edgeDisp);
    gl.uniform1i(loc.colorsLength, CONFIG.colors.length);
    gl.uniform4fv(loc.colors, flatColors);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    animId = requestAnimationFrame(render);
  }

  function startAnim() {
    if (!animId) {
      animId = requestAnimationFrame(render);
    }
  }

  // Pause WebGL rendering when canvas is out of screen viewport
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      isVisible = entry.isIntersecting;
      if (isVisible) {
        startAnim();
      }
    });
  }, { threshold: 0.01 });
  observer.observe(canvas);

  // Pause WebGL rendering when user switches tabs
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isVisible) {
      startAnim();
    }
  }, { passive: true });

  startAnim();
  }

  // Initialize both shader canvases
  initShader('glcanvas', 1.0, 210.0);
  initShader('glcanvas-cta', 0.5, 420.0); // Slower, different seed for variation
})();

// ── Services Floating Preview Follow Effect ──────────────────
(function () {
  const servicesSection = document.getElementById('servicos');
  const preview = document.getElementById('services-preview');
  const previewTrack = document.getElementById('services-preview-track');
  const rows = document.querySelectorAll('.service-row');
  if (!servicesSection || !preview || !previewTrack || !rows.length) return;

  // Track mouse coordinates
  let mouseX = 0;
  let mouseY = 0;
  let targetX = 0;
  let targetY = 0;
  const speed = 0.15; // Smooth interpolation factor (lerp)

  function updatePosition() {
    // Lerp coordinates for smooth follow lag
    mouseX += (targetX - mouseX) * speed;
    mouseY += (targetY - mouseY) * speed;

    preview.style.left = `${mouseX}px`;
    preview.style.top = `${mouseY}px`;

    requestAnimationFrame(updatePosition);
  }
  requestAnimationFrame(updatePosition);

  // Update target cursor coordinates
  window.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  // Shift slides on hover
  rows.forEach((row, index) => {
    row.addEventListener('mouseenter', () => {
      // Shift track to corresponding image (200px item height)
      previewTrack.style.transform = `translateY(${-index * 200}px)`;
      preview.classList.add('active');
      preview.setAttribute('aria-hidden', 'false');
    });

    row.addEventListener('mouseleave', () => {
      preview.classList.remove('active');
      preview.setAttribute('aria-hidden', 'true');
    });
  });
})();

// ── Custom Contextual Cursor ─────────────────────────────────
(function () {
  const cursor = document.getElementById('custom-cursor');
  const label = document.getElementById('custom-cursor-label');
  if (!cursor || !label) return;

  let targetX = 0, targetY = 0;
  let currentX = 0, currentY = 0;
  const lerpFactor = 0.2; // Smooth follow speed

  window.addEventListener('mousemove', (e) => {
    targetX = e.clientX;
    targetY = e.clientY;
  });

  function updateCursor() {
    currentX += (targetX - currentX) * lerpFactor;
    currentY += (targetY - currentY) * lerpFactor;
    cursor.style.left = `${currentX}px`;
    cursor.style.top = `${currentY}px`;
    requestAnimationFrame(updateCursor);
  }
  requestAnimationFrame(updateCursor);

  // View tag on projects
  document.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('mouseenter', () => {
      cursor.classList.add('custom-cursor--hovered');
      label.textContent = 'Ver';
    });
    card.addEventListener('mouseleave', () => {
      cursor.classList.remove('custom-cursor--hovered');
      label.textContent = '';
    });
  });

  // Scale on hover for interactive elements (grows more on buttons)
  const hoverables = document.querySelectorAll('a, button, .service-row, .testimonials__nav-btn');
  hoverables.forEach(el => {
    el.addEventListener('mouseenter', () => {
      if (!cursor.classList.contains('custom-cursor--hovered')) {
        const isButton = el.tagName === 'A' || el.tagName === 'BUTTON' || el.classList.contains('testimonials__nav-btn');
        cursor.style.transform = `translate(-50%, -50%) scale(${isButton ? 2.5 : 1.8})`;
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!cursor.classList.contains('custom-cursor--hovered')) {
        cursor.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    });
  });
})();

// ── Intersection Observer (Scroll Reveal) ────────────────────
(function () {
  const revealElements = document.querySelectorAll('.reveal');
  if (!revealElements.length) return;

  const observerOptions = {
    root: null,
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal--visible');
        revealObserver.unobserve(entry.target); // Animate only once
      }
    });
  }, observerOptions);

  revealElements.forEach(el => revealObserver.observe(el));
})();

// ── Lenis Smooth Scroll Initialization ────────────────────────
(function () {
  if (typeof Lenis === 'undefined') return;

  const lenis = new Lenis({
    duration: 1.4, // Increased scroll weight slightly
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // smooth easeOutExpo
    smoothWheel: true,
    orientation: 'vertical',
    gestureOrientation: 'vertical',
  });

  function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  // Link scroll navigation compatibility
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        lenis.scrollTo(target, { offset: -80 });
      }
    });
  });
})();

// ── Navbar Scrollspy (Active State Indicator) ────────────────
(function () {
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar__link');
  if (!sections.length || !navLinks.length) return;

  window.addEventListener('scroll', () => {
    let currentSectionId = '';
    const scrollPos = window.scrollY + 200;

    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.offsetHeight;
      if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
        currentSectionId = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('navbar__link--active');
      if (link.getAttribute('href') === `#${currentSectionId}`) {
        link.classList.add('navbar__link--active');
      }
    });
  });
})();





