#!/usr/bin/env node
/**
 * Generate a themed OG (Open Graph) social preview image for CloudVault.
 * Uses Sharp to composite an SVG overlay onto a purple gradient background.
 *
 * Run:  node scripts/generate-og.js
 * Output: public/og-image.png  (1200 × 630)
 */

const sharp = require('sharp');
const path = require('path');

const WIDTH = 1200;
const HEIGHT = 630;
const OUTPUT = path.join(__dirname, '..', 'public', 'og-image.png');

// Purple gradient background + all text/decorations as a single SVG
const svg = `
<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Main gradient: deep purple to violet -->
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#5b21b6"/>
      <stop offset="50%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>

    <!-- Subtle radial glow -->
    <radialGradient id="glow" cx="70%" cy="40%" r="50%">
      <stop offset="0%" stop-color="rgba(236,72,153,0.25)"/>
      <stop offset="100%" stop-color="rgba(236,72,153,0)"/>
    </radialGradient>

    <!-- Soft light for top-left corner -->
    <radialGradient id="cornerGlow" cx="15%" cy="20%" r="40%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>

  <!-- Background gradient -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>

  <!-- Pink glow accent -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#glow)"/>

  <!-- Corner highlight -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#cornerGlow)"/>

  <!-- Decorative circles (abstract media thumbnails) -->
  <!-- Large circle, top-right -->
  <circle cx="950" cy="160" r="120" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  <circle cx="950" cy="160" r="80" fill="rgba(255,255,255,0.04)"/>

  <!-- Small circle, bottom-right -->
  <circle cx="1080" cy="420" r="70" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>

  <!-- Tiny circle, top-left area -->
  <circle cx="180" cy="80" r="30" fill="rgba(255,255,255,0.06)"/>

  <!-- Decorative rounded rects (abstract photo cards) -->
  <rect x="820" y="280" width="140" height="140" rx="16" fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
  <rect x="990" y="310" width="120" height="120" rx="14" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
  <rect x="870" y="200" width="100" height="100" rx="12" fill="rgba(255,255,255,0.04)"/>

  <!-- Play icon inside one card (video indicator) -->
  <polygon points="975,350 975,380 1000,365" fill="rgba(255,255,255,0.25)"/>

  <!-- Photo icon inside another card -->
  <circle cx="890" cy="330" r="12" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
  <path d="M860,355 L875,340 L895,360 L905,350 L920,365" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Cloud icon (subtle, top area) -->
  <path d="M730,120 a35,35 0 0,1 60,-10 a25,25 0 0,1 40,15 a20,20 0 0,1 -5,38 h-90 a30,30 0 0,1 -5,-43z"
        fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5"/>

  <!-- Dotted pattern (subtle texture) -->
  <g fill="rgba(255,255,255,0.04)">
    <circle cx="50" cy="500" r="3"/>
    <circle cx="100" cy="520" r="3"/>
    <circle cx="150" cy="490" r="3"/>
    <circle cx="200" cy="540" r="3"/>
    <circle cx="250" cy="510" r="3"/>
    <circle cx="300" cy="550" r="3"/>
    <circle cx="350" cy="530" r="3"/>
    <circle cx="400" cy="560" r="3"/>
  </g>

  <!-- ════════════ TEXT ════════════ -->

  <!-- Brand name -->
  <text x="100" y="290" font-family="Georgia, 'Times New Roman', serif" font-size="72" font-weight="400" fill="white" letter-spacing="-1">
    CloudVault
  </text>

  <!-- Tagline -->
  <text x="104" y="340" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="26" font-weight="400" fill="rgba(255,255,255,0.75)" letter-spacing="0.5">
    Your personal media vault
  </text>

  <!-- Feature pills -->
  <g font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="15" font-weight="500">
    <!-- Upload pill -->
    <rect x="100" y="380" width="100" height="36" rx="18" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="150" y="403" text-anchor="middle" fill="rgba(255,255,255,0.9)">Upload</text>

    <!-- Organize pill -->
    <rect x="220" y="380" width="110" height="36" rx="18" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="275" y="403" text-anchor="middle" fill="rgba(255,255,255,0.9)">Organize</text>

    <!-- Share pill -->
    <rect x="350" y="380" width="90" height="36" rx="18" fill="rgba(255,255,255,0.15)" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <text x="395" y="403" text-anchor="middle" fill="rgba(255,255,255,0.9)">Share</text>
  </g>

  <!-- Bottom bar -->
  <rect x="0" y="590" width="${WIDTH}" height="40" fill="rgba(0,0,0,0.15)"/>
  <text x="100" y="616" font-family="'Segoe UI', 'Helvetica Neue', Arial, sans-serif" font-size="14" fill="rgba(255,255,255,0.5)" letter-spacing="1">
    SIMPLE &amp; SECURE MEDIA STORAGE
  </text>
</svg>
`;

async function generate() {
  try {
    await sharp(Buffer.from(svg))
      .png()
      .toFile(OUTPUT);

    console.log(`✅ OG image generated: ${OUTPUT}`);
    console.log(`   Dimensions: ${WIDTH} × ${HEIGHT}`);
  } catch (err) {
    console.error('❌ Failed to generate OG image:', err.message);
    process.exit(1);
  }
}

generate();
