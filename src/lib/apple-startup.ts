import devices from './apple-devices.json'

// Use the same device table as scripts/generate-apple-startup.mjs.
export const appleStartupLinks = devices.flatMap(([width, height, scale]) =>
  ['portrait', 'landscape'].flatMap((orientation) =>
    ['light', 'dark'].map((theme) => {
      const w = orientation === 'portrait' ? width : height
      const h = orientation === 'portrait' ? height : width
      return {
        rel: 'apple-touch-startup-image',
        href: `/startup/${w}x${h}@${scale}-${theme}.png?v1`,
        media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation}) and (prefers-color-scheme: ${theme})`,
      }
    }),
  ),
)
