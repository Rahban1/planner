# Apple design in Planner

Planner uses the [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines) for visual hierarchy, readable content, touch controls, and navigation. It keeps its own colors and brand. CSS materials approximate the appearance on the web; they do not provide native Liquid Glass.

- Shared styles are in `src/apple-design.css`. Keep translucent surfaces on navigation. Keep task content on solid panels.
- Use controls that are at least 44 CSS pixels high on phones. Keep form text at 16 pixels or more to prevent automatic zoom on focus.
- Keep a visible way to return from each page. The phone navigation remains available even when the desktop sidebar preference is hidden.
- Respect reduced motion, reduced transparency, and increased contrast preferences.
- `AppleWebAppRuntime` uses the visual viewport for keyboard and sheet sizing. Pinch zoom does not resize the app.
- The body has a real background color. The manifest uses the default dark launch color. Apple startup images include light and dark system themes.

## Startup images

Run `node scripts/generate-apple-startup.mjs` after changing the launch colors or `src/lib/apple-devices.json`. The table contains CSS width, height, and pixel ratio. Both the generator and the head links use this table. It produces 88 PNG files: 22 sizes, two orientations, and two themes. Increase the URL version in `src/lib/apple-startup.ts` after changing existing assets.

Startup images use the system color preference. iOS selects them before JavaScript runs, so they cannot reflect a different theme saved inside Planner. The existing Apple touch icon is an opaque 180-pixel PNG.

## Verification

Use the isolated local environment in `docs/UI_PROOF.md`. Check desktop, phone, tablet, portrait, landscape, light theme, dark theme, search, task navigation, and text input. Fetch the manifest, icons, and startup images without cookies. Check the rendered head tags.

Browser emulation cannot verify iOS status-bar tint, startup selection, keyboard animation, or safe-area timing. On a real iPhone and iPad, install the app, close it, and launch it again. Check the keyboard, landscape layout, and iPad window controls. On macOS, use Add to Dock and check navigation and external links. Reinstall after an icon or startup-image change because Apple caches these assets.

Sources: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), and [Layout](https://developer.apple.com/design/human-interface-guidelines/layout).
