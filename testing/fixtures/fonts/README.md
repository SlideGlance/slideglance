# testing/fixtures/fonts

Drop redistributable test fonts here so font-driven tests load from a
stable path (`testing/fixtures/fonts/<file>`) without depending on the
host's installed font catalog — that determinism rule matches the
production policy in `crates/slideglance-png/src/lib.rs`.

The repo ships **no fonts by default**. A fixture is just a TTF / OTF
/ TTC file. Permissively-licensed candidates that have historically
worked here:

- **DejaVu Sans** (`DejaVuSans.ttf`) — Bitstream Vera + DejaVu
  permissive licenses. Covers extended Latin and basic CJK.
  <https://dejavu-fonts.github.io/License.html>
- Any **SIL Open Font License** font (`OFL.txt` shipped alongside).
- **Apache-2.0** / **MIT** licensed fonts (Inter, Roboto, etc.).

Avoid copyrighted system fonts (Apple SD Gothic Neo, Microsoft Yi
Baiti, etc.) — those are licensed for OS use only and cannot be
checked in.

## Existing call sites

Search for `testing/fixtures/fonts` to find tests that load from this
directory; without the matching file present they panic at runtime
but the surrounding crate still compiles.
