/** Shared camera-space flow for the dormant head particles and the surrounding haze. */
export const DUST_CLOUD_FIELD_GLSL = /* glsl */ `
// Half-frustum slopes and camera distance: the field fills any viewport without scaling the head.
uniform vec3 uFieldView;

vec3 dustCloudPosition(vec4 seed, float time, out float light) {
  float lane = floor(seed.z * 4.0);
  float phase = lane * 1.91;
  float drift = time * (0.012 + lane * 0.003);
  float x = mod(seed.x * 2.8 + drift, 2.8) - 1.4;
  // A Gaussian cross-section makes dense wisps with sparse edges, rather than solid ribbons.
  float spread = sqrt(-2.0 * log(max(0.001, seed.y))) * cos(seed.w * 6.283185);
  float ribbon = -0.78 + lane * 0.52;
  ribbon += 0.19 * sin(x * 2.5 + phase + time * 0.065);
  ribbon += 0.075 * sin(x * 6.4 - phase - time * 0.043);
  float width = 0.065 + 0.085 * (0.5 + 0.5 * sin(x * 3.1 + phase));
  vec2 p = vec2(x, ribbon + spread * width);

  // Small eddies gently fold the clouds. No rapid flashing or abrupt global reset.
  vec2 center = vec2(0.52 * sin(phase + 0.7), -0.45 + lane * 0.3);
  vec2 d = p - center;
  float turn = exp(-dot(d, d) * 3.6) * (0.85 + 0.3 * sin(time * 0.08 + phase));
  float c = cos(turn), s = sin(turn);
  p = center + mat2(c, -s, s, c) * d;

  // A quieter, unclustered population gives the space depth between clouds.
  float dispersed = step(0.78, seed.w);
  p = mix(p, vec2(x, (seed.y * 2.0 - 1.0) * 1.3), dispersed);
  float depth = uFieldView.z * (0.72 + seed.z * 0.85);
  p += 0.018 * vec2(sin(time * 0.11 + seed.z * 12.0), cos(time * 0.09 + seed.z * 9.0));
  // Fade wrapping particles beyond the screen, including the cloud's curled edges.
  light = (1.0 - smoothstep(1.12, 1.4, abs(x))) * mix(1.0, 0.32, dispersed);
  light *= 0.68 + 0.32 * pow(0.5 + 0.5 * sin(time * (0.55 + seed.y * 0.4) + seed.w * 80.0), 3.0);
  float glint = step(0.985, fract(seed.y * 33.13 + seed.w * 99.17));
  glint *= pow(0.5 + 0.5 * sin(time * 0.95 + seed.x * 200.0), 12.0);
  light *= 1.0 + glint * 2.8;
  return vec3(p * uFieldView.xy * depth, -depth);
}
`
