/** PCM16 <-> base64 <-> float helpers for the Voice Agent WebSocket. Pure; shared with the node tests. */

export const AGENT_SAMPLE_RATE = 24000

/** Base64 PCM16 little-endian mono -> float samples in [-1, 1]. */
export function decodePcm16Base64(b64: string): Float32Array {
  const raw = atob(b64)
  const count = raw.length >> 1
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    let v = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8)
    if (v >= 0x8000) v -= 0x10000
    out[i] = v / 32768
  }
  return out
}

/** Raw PCM16 bytes -> base64, chunked so very long buffers never overflow the argument list. */
export function encodePcm16Base64(pcm: ArrayBuffer | Int16Array): string {
  const bytes = pcm instanceof Int16Array ? new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength) : new Uint8Array(pcm)
  let binary = ''
  const step = 0x2000
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[])
  }
  return btoa(binary)
}

export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  return out
}

/** Linear resampler for whole buffers (the capture worklet keeps its own streaming variant). */
export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input.slice()
  const ratio = from / to
  const length = Math.max(0, Math.floor((input.length - 1) / ratio) + 1)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const frac = pos - j
    const a = input[j] ?? 0
    const b = input[j + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}
