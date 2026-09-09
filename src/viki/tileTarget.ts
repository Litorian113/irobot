/** Shared target sampling keeps simulated tiles attached to the live speaking face. */
export const TILE_TARGET_GLSL = /* glsl */ `
uniform sampler2D uFront, uBack;
uniform float uCell, uFill, uStep, uTime, uVariation, uExtent, uCenterY, uFloor;
uniform vec3 uHeadOffset, uHeadScale;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
struct TileTarget { vec3 head; vec3 rest; float valid; float free; float seed; };
TileTarget tileTarget(vec2 aCell, float aBack) {
  vec2 uv = aCell * 0.5 + 0.5;
  vec4 face = texture2D(uFront, uv);
  vec4 rear = texture2D(uBack, vec2(1.0 - uv.x, uv.y));
  vec2 cellPosition = aCell * uExtent + vec2(0.0, uCenterY);
  float localY = (cellPosition.y - uHeadOffset.y) * 0.29 / uHeadScale.y;
  float valid = step(0.35, face.b) * step(-0.11, localY);
  float seed = hash(aCell + aBack * 3.1);
  float r2 = hash(aCell.yx + 4.7 + aBack);
  float r3 = hash(aCell + 11.3 + aBack);
  float zFront = floor(face.r / uStep) * uStep;
  float zBack = floor(rear.r / uStep) * uStep;
  if (aBack > 0.5) valid *= step(0.35, rear.b);
  vec3 assembled = vec3(cellPosition, mix(zFront, zBack, aBack));
  // The crown opens into scattered flakes; the facial landmarks stay intact.
  float crown = smoothstep(0.85, 1.15, localY);
  float loose = step(seed, crown * (0.65 + uVariation * 0.45));
  loose = max(loose, step(0.996, r3));
  float orbit = r2 * 6.283185;
  vec3 floating = vec3(cos(orbit) * uExtent * (0.70 + r3 * 0.22),
    uCenterY + sin(orbit) * uExtent * 0.72, (r3 - 0.5) * 0.7);
  floating += vec3(sin(uTime * 0.32 + r2 * 30.0),
    sin(uTime * 0.5 + r3 * 20.0), cos(uTime * 0.3 + r2 * 10.0)) * 0.025;
  // One wide, flat carpet of tiles. Every tile keeps its resting place.
  float radius = sqrt(seed) * uExtent * 0.92;
  float angle = r2 * 6.283185;
  vec3 resting = vec3(cos(angle) * radius,
    uFloor + 0.02 + hash(aCell + 25.0) * 0.05,
    sin(angle) * radius * 0.55);
  // Most missing crown pieces stay on the floor; only a few hover nearby.
  float hovering = step(0.84, hash(aCell + 42.9 + aBack));
  assembled = mix(assembled, mix(resting, floating, hovering), loose);

  // Cells far outside the head carpet the whole scene width instead: they ride
  // the levitation up and rain back down, so the ground reads as one plane.
  // The 0.06..0.35 mask band stays hidden - speech only wobbles the silhouette
  // there, and those cells must never flip between head and floor.
  float mask = aBack > 0.5 ? rear.b : face.b;
  float dweller = max(step(mask, 0.06), 1.0 - step(-0.11, localY));
  vec3 planeRest = vec3((hash(aCell + 31.7 + aBack) - 0.5) * uExtent * 4.8,
    uFloor + 0.02 + hash(aCell + 25.0) * 0.05,
    (hash(aCell.yx + 57.1 + aBack) - 0.5) * uExtent * 1.7);
  resting = mix(resting, planeRest, dweller);
  assembled = mix(assembled, planeRest, dweller);
  valid = max(valid, dweller);

  return TileTarget(assembled, resting, valid, loose * hovering * (1.0 - dweller), seed);
}
// A flat collision bed: tiles land and stay wherever they hit the ground,
// so the carpet spreads evenly instead of forming mounds or craters.
float tileFloor(vec2 p) {
  return uFloor + uCell * 0.75;
}
`;
