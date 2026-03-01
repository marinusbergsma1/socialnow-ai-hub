/**
 * SocialNow AI Hub - Particle Canvas System
 * Creates a constellation/particle network effect with mouse interaction.
 * Inspired by socialnow.nl pixelated canvas aesthetic.
 */
(function () {
  'use strict';

  // --- Configuration ---
  var CONFIG = {
    particleCount: 80,
    color: { r: 37, g: 211, b: 102 },       // #25D366
    minRadius: 1,
    maxRadius: 2,
    brightRadius: 3,
    brightChance: 0.15,                       // 15% of particles are brighter/larger
    baseSpeed: 0.3,
    connectionDistance: 120,
    connectionAlphaMin: 0.1,
    connectionAlphaMax: 0.2,
    mouseRadius: 150,
    mouseAttractionStrength: 0.02,
    mouseGlowRadius: 200,
    mouseGlowAlpha: 0.06,
    velocityDamping: 0.98,
    edgeBounce: 0.5,
    baseAlphaMin: 0.25,
    baseAlphaMax: 0.7,
    brightAlphaMin: 0.7,
    brightAlphaMax: 1.0,
    energySpeedMultiplier: 1.8,
    energyAlphaBoost: 0.3
  };

  // --- State ---
  var canvas = document.getElementById('particleCanvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  var particles = [];
  var mouse = { x: -9999, y: -9999, active: false };
  var animationId = null;
  var isVisible = true;

  // Apply pixelated rendering for retro feel
  canvas.style.imageRendering = 'pixelated';
  canvas.style.imageRendering = '-moz-crisp-edges';
  canvas.style.imageRendering = 'crisp-edges';

  // --- Utility ---
  function rand(min, max) {
    return Math.random() * (max - min) + min;
  }

  function distSq(x1, y1, x2, y2) {
    var dx = x1 - x2;
    var dy = y1 - y2;
    return dx * dx + dy * dy;
  }

  // --- Particle ---
  function createParticle() {
    var isBright = Math.random() < CONFIG.brightChance;
    return {
      x: rand(0, canvas.width),
      y: rand(0, canvas.height),
      vx: rand(-CONFIG.baseSpeed, CONFIG.baseSpeed),
      vy: rand(-CONFIG.baseSpeed, CONFIG.baseSpeed),
      radius: isBright ? rand(2, CONFIG.brightRadius) : rand(CONFIG.minRadius, CONFIG.maxRadius),
      baseAlpha: isBright
        ? rand(CONFIG.brightAlphaMin, CONFIG.brightAlphaMax)
        : rand(CONFIG.baseAlphaMin, CONFIG.baseAlphaMax),
      alpha: 0,
      bright: isBright
    };
  }

  function initParticles() {
    particles = [];
    for (var i = 0; i < CONFIG.particleCount; i++) {
      particles.push(createParticle());
    }
  }

  // --- Resize ---
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  // --- Update ---
  function updateParticle(p) {
    var mouseDistSq = distSq(p.x, p.y, mouse.x, mouse.y);
    var mouseRadiusSq = CONFIG.mouseRadius * CONFIG.mouseRadius;
    var nearMouse = mouse.active && mouseDistSq < mouseRadiusSq;

    // Mouse attraction
    if (nearMouse) {
      var dist = Math.sqrt(mouseDistSq);
      var force = (1 - dist / CONFIG.mouseRadius) * CONFIG.mouseAttractionStrength;
      p.vx += (mouse.x - p.x) * force;
      p.vy += (mouse.y - p.y) * force;
    }

    // Add slight random drift
    p.vx += rand(-0.05, 0.05);
    p.vy += rand(-0.05, 0.05);

    // Velocity damping
    p.vx *= CONFIG.velocityDamping;
    p.vy *= CONFIG.velocityDamping;

    // Speed limit (particles near mouse can move faster)
    var maxSpeed = nearMouse ? CONFIG.baseSpeed * CONFIG.energySpeedMultiplier : CONFIG.baseSpeed;
    var speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed > maxSpeed) {
      p.vx = (p.vx / speed) * maxSpeed;
      p.vy = (p.vy / speed) * maxSpeed;
    }

    // Move
    p.x += p.vx;
    p.y += p.vy;

    // Soft edge bounce
    if (p.x < 0) {
      p.x = 0;
      p.vx *= -CONFIG.edgeBounce;
    } else if (p.x > canvas.width) {
      p.x = canvas.width;
      p.vx *= -CONFIG.edgeBounce;
    }
    if (p.y < 0) {
      p.y = 0;
      p.vy *= -CONFIG.edgeBounce;
    } else if (p.y > canvas.height) {
      p.y = canvas.height;
      p.vy *= -CONFIG.edgeBounce;
    }

    // Alpha: boost when near mouse
    if (nearMouse) {
      var proximity = 1 - Math.sqrt(mouseDistSq) / CONFIG.mouseRadius;
      p.alpha = Math.min(1, p.baseAlpha + proximity * CONFIG.energyAlphaBoost);
    } else {
      p.alpha = p.baseAlpha;
    }
  }

  // --- Draw ---
  function drawConnections() {
    var maxDistSq = CONFIG.connectionDistance * CONFIG.connectionDistance;
    var c = CONFIG.color;

    for (var i = 0; i < particles.length; i++) {
      for (var j = i + 1; j < particles.length; j++) {
        var dSq = distSq(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
        if (dSq < maxDistSq) {
          var ratio = 1 - Math.sqrt(dSq) / CONFIG.connectionDistance;
          var alpha = CONFIG.connectionAlphaMin + ratio * (CONFIG.connectionAlphaMax - CONFIG.connectionAlphaMin);
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha.toFixed(3) + ')';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
  }

  function drawParticles() {
    var c = CONFIG.color;
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + p.alpha.toFixed(3) + ')';
      ctx.fill();
    }
  }

  function drawMouseGlow() {
    if (!mouse.active) return;
    var c = CONFIG.color;
    var gradient = ctx.createRadialGradient(
      mouse.x, mouse.y, 0,
      mouse.x, mouse.y, CONFIG.mouseGlowRadius
    );
    gradient.addColorStop(0, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + CONFIG.mouseGlowAlpha + ')');
    gradient.addColorStop(1, 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0)');
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, CONFIG.mouseGlowRadius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  // --- Animation Loop ---
  function frame() {
    if (!isVisible) {
      animationId = null;
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update all particles
    for (var i = 0; i < particles.length; i++) {
      updateParticle(particles[i]);
    }

    // Draw in order: glow -> connections -> particles
    drawMouseGlow();
    drawConnections();
    drawParticles();

    animationId = requestAnimationFrame(frame);
  }

  function start() {
    if (animationId) return;
    animationId = requestAnimationFrame(frame);
  }

  function stop() {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }

  // --- Events ---
  window.addEventListener('resize', function () {
    resize();
  });

  window.addEventListener('mousemove', function (e) {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  window.addEventListener('mouseleave', function () {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      isVisible = false;
      stop();
    } else {
      isVisible = true;
      start();
    }
  });

  // --- Init ---
  resize();
  initParticles();
  start();
})();
