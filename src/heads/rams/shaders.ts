/**
 * R.A.M.S.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives. The scene renders without
 * post-processing, so each one applies tone mapping and colour space itself.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * An eye behind the glasses: a turned aluminium dial with a dark pupil that
 * leans where it looks. The lid of the housing comes down for a blink, and
 * rises from below when he smiles.
 */
export const DIAL_FRAGMENT = /* glsl */ `
uniform vec2 uLook;
uniform float uBlink, uSmile, uSheen, uPupil;
uniform vec3 uLid;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float a = atan(p.y, p.x);

  // Turned aluminium: fine concentric grooves, a highlight across the centre.
  float grooves = 0.05 * sin(r * 190.0) + 0.03 * sin(r * 530.0 + 1.3);
  float sheen = pow(abs(cos(a - uSheen)), 8.0);
  vec3 col = vec3(0.36, 0.37, 0.38) * (0.9 + grooves) + vec3(0.32) * sheen * smoothstep(0.05, 0.4, r);

  // The pupil, with a small catchlight.
  vec2 q = p - uLook;
  col = mix(col, vec3(0.01), smoothstep(uPupil + 0.025, uPupil - 0.025, length(q)));
  vec2 c = q - vec2(-0.3, 0.35) * uPupil;
  col += vec3(0.9) * exp(-dot(c, c) * 900.0);

  // The dial sits in a recess: darker towards the frame.
  col *= mix(1.0, 0.35, smoothstep(0.78, 1.0, r));

  // Lids in the colour of the housing: from above to blink, from below to smile.
  float upper = smoothstep(-0.03, 0.03, p.y - (1.05 - 2.1 * uBlink));
  float lower = smoothstep(0.03, -0.03, p.y - (-1.05 + 0.75 * uSmile - 0.35 * uSmile * p.x * p.x));
  col = mix(col, uLid, max(upper, lower));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** A soft contact shadow on the housing, under the glasses and the keys. Multiplied. */
export const SHADOW_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float d = max(length(p) - 0.55, 0.0);
  float shade = uStrength * exp(-d * d * 14.0) * smoothstep(1.0, 0.7, length(p));
  gl_FragColor = vec4(vec3(1.0 - shade), 1.0);
}
`

/** The wall behind: warm white, a little brighter behind the head, like a catalogue page. */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(40.0, 24.0);
  float light = 0.5 + 0.16 * exp(-dot(p, p) * 0.02) - 0.005 * p.y;
  gl_FragColor = vec4(vec3(1.0, 0.975, 0.94) * light, 1.0);
  #include <colorspace_fragment>
}
`
