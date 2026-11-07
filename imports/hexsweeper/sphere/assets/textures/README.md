# Globe texture sources

[`sources.json`](sources.json) records the exact files, checksums, source chain,
and transformations.

## Earth and Moon daymaps

`earth_daymap_2k.jpg` and `moon_2k.jpg` are credited to
[Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/) under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
They were copied unchanged from
[Orrery's planet textures](https://github.com/data-poems/orrery/tree/10d7586b2e3554b09a2ea8cbbe646a7adf9a7a51/public/textures).
Both SHA-256 values match that source exactly, whose
[retained notice](https://github.com/data-poems/orrery/blob/10d7586b2e3554b09a2ea8cbbe646a7adf9a7a51/THIRD_PARTY_NOTICES.md)
identifies the creator and license.

The JPEGs retain an encoder comment, but their original upstream conversion
recipe was not retained. Current downloads from Solar System Scope have
different bytes. Preserve this modification history and the attribution when
redistributing these files.

Solar System Scope describes its maps as adjusted imagery using NASA data.
The applicable license here is its CC BY 4.0 grant. NASA's data contribution
does not substitute for the retained texture attribution.

## Earth gloss

`earth_gloss_4k.webp` and `earth_gloss_2k.webp` are stylized project artwork
prepared for Hexsweeper by Luke Steuber on August 14, 2026. Both derive from one
preserved PNG. Lanczos resize, sRGB conversion, and WebP quality 88 (4K) or
86 (2K) reproduce the tracked files byte for byte. The source PNG checksum is
recorded in the manifest.

The current Earth theme uses these gloss images. The older Earth daymap is
retained in source history; the Moon theme continues to use `moon_2k.jpg`.
