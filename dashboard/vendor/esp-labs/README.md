# esp-labs-web procedural board port

This folder contains framework-free JavaScript adapted from
[esp-labs-web](https://github.com/agharsallah/esp-labs-web), commit not supplied with the
proof of concept archive. The upstream project is MIT licensed, copyright (c) 2026
Abderrehmen Gharsallah. The full notice is in `THIRD_PARTY_NOTICE.txt`.

| Setu file | Upstream path | Setu change |
| --- | --- | --- |
| `stage3d.js` | `src/ui/stage3d/stage3d.ts` | Removed TypeScript syntax and rewrote imports. |
| `toon.js` | `src/ui/stage3d/toon.ts` | Removed TypeScript syntax and rewrote imports. |
| `esp32-scene.js` | `src/features/home/board3d/esp32-scene.ts` | Removed TypeScript syntax and rewrote imports. |
| `board.js` | `src/domain/board.ts` | Removed TypeScript syntax and rewrote imports. |
| `palette.js` | `src/lib/palette.ts` | Replaced the palette helper with a CSS custom-property reader. |

Project Setu added public API JSDoc for `Stage3d`, `buildBoardScene`, and
`PART_ANCHORS`. The scene is loaded only by the future hardware explorer entry point.
No upstream lesson copy, translations, icons, brand assets, or documentation images are
included.
