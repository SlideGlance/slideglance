#!/usr/bin/env bash
#
# Build the @slideglance/core wasm artefacts for every consumer target.
#
# Why this script exists
# ----------------------
# wasm-pack writes to a single `--out-dir`. The `@slideglance/core` package
# ships THREE target builds — `dist/bundler/`, `dist/web/`, `dist/node/`
# — because consumers pick whichever `exports.*` subpath matches their
# tooling. Forgetting to refresh ALL three after a Rust change leaves
# stale wasm in whichever target the consumer happens to import (most
# commonly `dist/bundler/`, which the playground imports through Vite).
#
# Wired as a `prebuild` hook on every JS package that depends on
# `@slideglance/core` (viewer, chrome-extension, web-playground), so a
# stale .wasm bundled into a downstream app cannot happen by accident.
#
# Up-to-date detection
# --------------------
# The hook runs on every JS build, but the heavy `wasm-pack` work is
# only done when something under `crates/` (or `Cargo.toml` /
# `Cargo.lock` / this script itself / the cached profile) is newer
# than the most recent `slideglance_wasm_bg.wasm` artefact. On a no-op
# rebuild the script returns in well under 100 ms — the cost of one
# `find` walk over `crates/` minus its `target/` subtree.
#
# Usage
# -----
#   ./scripts/build-wasm.sh             # release builds (default)
#   PROFILE=dev ./scripts/build-wasm.sh # debug builds (faster, larger)
#   FORCE=1 ./scripts/build-wasm.sh     # always rebuild, ignore cache

set -euo pipefail

PROFILE="${PROFILE:-release}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE_DIR="${ROOT}/crates/slideglance-wasm"
OUT_BASE="${ROOT}/packages/core/dist"
SCRIPT_PATH="${BASH_SOURCE[0]}"
# Stamp file records the profile of the last successful build. Profile
# changes (`release` ↔ `dev`) must always trigger a rebuild because
# wasm-pack overwrites the same out-dir with binaries that have very
# different size and debuginfo characteristics.
STAMP="${OUT_BASE}/.build-wasm.profile"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack not found in PATH" >&2
  echo "       install via 'cargo install wasm-pack' or" >&2
  echo "       'curl https://rustwasm.github.io/wasm-pack/installer/init.sh | sh'" >&2
  exit 1
fi

PROFILE_FLAG=""
if [[ "${PROFILE}" == "dev" ]]; then
  PROFILE_FLAG="--dev"
elif [[ "${PROFILE}" != "release" ]]; then
  echo "error: PROFILE must be 'release' or 'dev', got '${PROFILE}'" >&2
  exit 1
fi

# ---- Up-to-date short-circuit ---------------------------------------
#
# Skip the build entirely when:
#   1. FORCE is not set,
#   2. the cached profile matches the requested profile,
#   3. all three target wasm artefacts exist, AND
#   4. nothing under `crates/` (excluding `target/`) or
#      `Cargo.toml` / `Cargo.lock` / this script is newer than the
#      bundler artefact (which is built first below — a successful
#      run leaves it as the oldest of the three).
last_profile=""
if [[ -f "${STAMP}" ]]; then
  last_profile=$(cat "${STAMP}")
fi

bundler_wasm="${OUT_BASE}/bundler/slideglance_wasm_bg.wasm"
web_wasm="${OUT_BASE}/web/slideglance_wasm_bg.wasm"
node_wasm="${OUT_BASE}/node/slideglance_wasm_bg.wasm"

if [[ "${FORCE:-0}" != "1" && \
      "${last_profile}" == "${PROFILE}" && \
      -f "${bundler_wasm}" && -f "${web_wasm}" && -f "${node_wasm}" ]]; then
  # `find` returns the first source newer than the artefact and exits;
  # an empty result means everything is up to date.
  newer=$(find "${ROOT}/crates" \
            \! -path "${ROOT}/crates/target*" \
            -type f -newer "${bundler_wasm}" -print -quit 2>/dev/null || true)
  if [[ -z "${newer}" ]]; then
    # Also check workspace-level files and this script itself.
    for extra in "${ROOT}/Cargo.toml" "${ROOT}/Cargo.lock" "${SCRIPT_PATH}"; do
      if [[ -f "${extra}" && "${extra}" -nt "${bundler_wasm}" ]]; then
        newer="${extra}"
        break
      fi
    done
  fi
  if [[ -z "${newer}" ]]; then
    echo "[build-wasm] up to date (profile=${PROFILE}) — skipping. Set FORCE=1 to override."
    exit 0
  fi
  echo "[build-wasm] source changed: ${newer}"
fi

echo "[build-wasm] root        = ${ROOT}"
echo "[build-wasm] crate       = ${CRATE_DIR}"
echo "[build-wasm] out base    = ${OUT_BASE}"
echo "[build-wasm] profile     = ${PROFILE}"

for target in bundler web nodejs; do
  case "${target}" in
    bundler) outdir="${OUT_BASE}/bundler" ;;
    web)     outdir="${OUT_BASE}/web" ;;
    nodejs)  outdir="${OUT_BASE}/node" ;;
  esac
  echo
  echo "[build-wasm] >>> target=${target} -> ${outdir}"
  wasm-pack build \
    "${CRATE_DIR}" \
    --target "${target}" \
    --out-dir "${outdir}" \
    ${PROFILE_FLAG}
done

# Persist the profile of the successful build so subsequent invocations
# can detect a profile flip and skip otherwise.
mkdir -p "${OUT_BASE}"
echo "${PROFILE}" > "${STAMP}"

echo
echo "[build-wasm] all targets built successfully."
