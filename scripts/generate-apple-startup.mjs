import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'

// Plain launch backgrounds avoid showing a logo before the content is ready.
// Encode RGB PNGs directly so asset generation needs no image dependency.
const devices = JSON.parse(
  await readFile(
    new URL('../src/lib/apple-devices.json', import.meta.url),
    'utf8',
  ),
)
const output = new URL('../public/startup/', import.meta.url)
await mkdir(output, { recursive: true })
function chunk(type, data) {
  const bytes = Buffer.concat([Buffer.from(type), data])
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  const size = Buffer.alloc(4)
  size.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, bytes, checksum])
}
for (const [width, height, scale] of devices) {
  for (const [w, h] of [
    [width, height],
    [height, width],
  ]) {
    for (const [theme, color] of Object.entries({
      light: [241, 238, 229],
      dark: [23, 24, 20],
    })) {
      const pw = w * scale
      const ph = h * scale
      const header = Buffer.alloc(13)
      header.writeUInt32BE(pw, 0)
      header.writeUInt32BE(ph, 4)
      header[8] = 8
      header[9] = 2
      const row = Buffer.alloc(1 + pw * 3)
      for (let x = 1; x < row.length; x += 3) {
        row[x] = color[0]
        row[x + 1] = color[1]
        row[x + 2] = color[2]
      }
      const pixels = Buffer.alloc(row.length * ph)
      for (let y = 0; y < ph; y++) row.copy(pixels, y * row.length)
      const png = Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(pixels, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
      ])
      await writeFile(new URL(`${w}x${h}@${scale}-${theme}.png`, output), png)
    }
  }
}
console.log(`Created ${devices.length * 4} startup images.`)
