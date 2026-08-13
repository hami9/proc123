/**
 * Synchronous SHA-256.
 *
 * SKU generation has to be deterministic and identical in an MV3 service
 * worker, a content script and Node. `crypto.subtle` is async and
 * `node:crypto` does not exist in the browser, so the hash lives here.
 * Correctness is pinned by the NIST test vectors in the unit tests.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL_HASH = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const rotr = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

const at = (array: Uint32Array, index: number): number => array[index] ?? 0;

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;

  // Pad to a multiple of 64 bytes: 0x80, zeros, then the length as 64-bit BE.
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = Uint32Array.from(INITIAL_HASH);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      schedule[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      const w15 = at(schedule, i - 15);
      const w2 = at(schedule, i - 2);
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      schedule[i] = (at(schedule, i - 16) + s0 + at(schedule, i - 7) + s1) >>> 0;
    }

    let a = at(hash, 0);
    let b = at(hash, 1);
    let c = at(hash, 2);
    let d = at(hash, 3);
    let e = at(hash, 4);
    let f = at(hash, 5);
    let g = at(hash, 6);
    let h = at(hash, 7);

    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + at(K, i) + at(schedule, i)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (at(hash, 0) + a) >>> 0;
    hash[1] = (at(hash, 1) + b) >>> 0;
    hash[2] = (at(hash, 2) + c) >>> 0;
    hash[3] = (at(hash, 3) + d) >>> 0;
    hash[4] = (at(hash, 4) + e) >>> 0;
    hash[5] = (at(hash, 5) + f) >>> 0;
    hash[6] = (at(hash, 6) + g) >>> 0;
    hash[7] = (at(hash, 7) + h) >>> 0;
  }

  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += at(hash, i).toString(16).padStart(8, '0');
  }
  return hex;
}

/**
 * A short, stable, URL-safe digest.
 *
 * Uniform over 36^length values (the modulo is taken over 64 bits of digest, so
 * no bias worth caring about). At the default 8 characters that is ~2.8e12
 * values: a 10,000-product catalogue has roughly a 1-in-56-million chance of a
 * collision, and the exporter still de-duplicates SKUs afterwards regardless.
 */
export function shortHash(input: string, length = 8): string {
  const digest = BigInt(`0x${sha256Hex(input).slice(0, 16)}`);
  const modulus = 36n ** BigInt(length);
  return (digest % modulus).toString(36).padStart(length, '0');
}
