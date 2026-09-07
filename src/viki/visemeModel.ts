/** Decode the pinned HeadAudio binary format (12 MFCCs, packed 12×12 inverse covariance). */
export function decodeVisemeModel(buffer: ArrayBuffer) {
  const stride = 368
  if (!buffer.byteLength || buffer.byteLength % stride) throw new Error('Invalid viseme model size')
  const model = []
  for (let offset = 0; offset < buffer.byteLength; offset += stride) {
    const header = new DataView(buffer, offset, 8)
    const packed = header.getUint32(0)
    const phoneme = String.fromCodePoint(packed >>> 16) + ((packed & 0xffff) ? String.fromCodePoint(packed & 0xffff) : '')
    const viseme = header.getUint8(7)
    const mu = new Float32Array(buffer, offset + 8, 12)
    const sigmaInvLower = new Float32Array(buffer, offset + 56, 78)
    if (viseme > 14 || !mu.every(Number.isFinite) || !sigmaInvLower.every(Number.isFinite)) throw new Error('Invalid viseme prototype')
    model.push({ phoneme, group: header.getUint8(5), viseme, mu, sigmaInvLower })
  }
  return model
}
