// Shared client script for the three landing pages (root, /view/, /build/).
// Four concerns in one file (each small, shared across pages): theme
// toggle, syntax highlighter for `pre code[data-lang]` blocks,
// playground-iframe overlay, and screenshot lightbox.

(() => {
  // ---------- syntax highlighter ----------
  // Tokenises XML / TypeScript / bash into an array of
  // `{ kind, text }` entries, then builds the highlighted output
  // exclusively via createTextNode / createElement / textContent —
  // never via innerHTML, so even a hostile `data-lang` block cannot
  // inject HTML. The token CSS lives in styles.css under
  // `pre code .tk-…` so runtime-inserted spans match the hand-written
  // spans on the top `.build-snippet`. Runs once on DOMContentLoaded,
  // idempotent via `data-highlighted`.

  function pushToken(out, kind, text) {
    if (text === "") return;
    if (kind === null) {
      const last = out[out.length - 1];
      if (last && last.kind === null) {
        last.text += text;
        return;
      }
    }
    out.push({ kind, text });
  }

  function tokenizeXml(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      if (src.substr(i, 4) === "<!--") {
        const end = src.indexOf("-->", i + 4);
        const stop = end === -1 ? n : end + 3;
        pushToken(out, "comment", src.slice(i, stop));
        i = stop;
        continue;
      }
      if (src[i] === "<") {
        let j = i + 1;
        let closing = false;
        if (src[j] === "/") {
          closing = true;
          j++;
        }
        const nameStart = j;
        while (j < n && /[\w:.-]/.test(src[j])) j++;
        const tagName = src.slice(nameStart, j);
        pushToken(out, "punct", closing ? "</" : "<");
        pushToken(out, "tag", tagName);
        while (
          j < n &&
          src[j] !== ">" &&
          !(src[j] === "/" && src[j + 1] === ">")
        ) {
          if (/\s/.test(src[j])) {
            pushToken(out, null, src[j]);
            j++;
            continue;
          }
          const aStart = j;
          while (j < n && /[\w:.-]/.test(src[j])) j++;
          const attrName = src.slice(aStart, j);
          if (attrName.length === 0) {
            pushToken(out, null, src[j]);
            j++;
            continue;
          }
          const colonIdx = attrName.indexOf(":");
          if (colonIdx > 0) {
            pushToken(out, "ns", attrName.slice(0, colonIdx + 1));
            pushToken(out, "attr", attrName.slice(colonIdx + 1));
          } else {
            pushToken(out, "attr", attrName);
          }
          while (j < n && /\s/.test(src[j])) {
            pushToken(out, null, src[j]);
            j++;
          }
          if (src[j] === "=") {
            pushToken(out, "punct", "=");
            j++;
            while (j < n && /\s/.test(src[j])) {
              pushToken(out, null, src[j]);
              j++;
            }
            if (src[j] === '"' || src[j] === "'") {
              const quote = src[j];
              const sStart = j;
              j++;
              while (j < n && src[j] !== quote) j++;
              if (j < n) j++;
              pushToken(out, "str", src.slice(sStart, j));
            }
          }
        }
        if (src[j] === "/" && src[j + 1] === ">") {
          pushToken(out, "punct", "/>");
          j += 2;
        } else if (src[j] === ">") {
          pushToken(out, "punct", ">");
          j++;
        }
        i = j;
        continue;
      }
      if (src[i] === "{") {
        const end = src.indexOf("}", i + 1);
        if (end !== -1 && end - i < 80) {
          pushToken(out, "interp", src.slice(i, end + 1));
          i = end + 1;
          continue;
        }
      }
      pushToken(out, null, src[i]);
      i++;
    }
    return out;
  }

  const TS_KEYWORDS = new Set([
    "import",
    "from",
    "export",
    "default",
    "const",
    "let",
    "var",
    "await",
    "async",
    "function",
    "return",
    "if",
    "else",
    "for",
    "while",
    "class",
    "new",
    "typeof",
    "interface",
    "type",
    "of",
    "as",
  ]);

  function tokenizeTs(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      if (src[i] === "/" && src[i + 1] === "/") {
        let end = src.indexOf("\n", i);
        if (end === -1) end = n;
        pushToken(out, "comment", src.slice(i, end));
        i = end;
        continue;
      }
      if (src[i] === "/" && src[i + 1] === "*") {
        let end = src.indexOf("*/", i + 2);
        if (end === -1) end = n;
        else end += 2;
        pushToken(out, "comment", src.slice(i, end));
        i = end;
        continue;
      }
      if (src[i] === '"' || src[i] === "'" || src[i] === "`") {
        const quote = src[i];
        let j = i + 1;
        while (j < n && src[j] !== quote) {
          if (src[j] === "\\") j++;
          j++;
        }
        if (j < n) j++;
        pushToken(out, "str", src.slice(i, j));
        i = j;
        continue;
      }
      if (/[0-9]/.test(src[i])) {
        let j = i;
        while (j < n && /[\d._]/.test(src[j])) j++;
        pushToken(out, "num", src.slice(i, j));
        i = j;
        continue;
      }
      if (/[a-zA-Z_$]/.test(src[i])) {
        let j = i;
        while (j < n && /[\w$]/.test(src[j])) j++;
        const word = src.slice(i, j);
        pushToken(out, TS_KEYWORDS.has(word) ? "kw" : null, word);
        i = j;
        continue;
      }
      pushToken(out, null, src[i]);
      i++;
    }
    return out;
  }

  function tokenizeBash(src) {
    const out = [];
    let i = 0;
    const n = src.length;
    while (i < n) {
      if (src[i] === "#") {
        const end = src.indexOf("\n", i);
        const stop = end === -1 ? n : end;
        pushToken(out, "comment", src.slice(i, stop));
        i = stop;
        continue;
      }
      pushToken(out, null, src[i]);
      i++;
    }
    return out;
  }

  function applyTokens(el, tokens) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const t of tokens) {
      if (t.kind === null) {
        el.appendChild(document.createTextNode(t.text));
      } else {
        const span = document.createElement("span");
        span.className = "tk-" + t.kind;
        span.textContent = t.text;
        el.appendChild(span);
      }
    }
  }

  function highlightAll() {
    for (const el of document.querySelectorAll("pre code[data-lang]")) {
      if (el.dataset.highlighted) continue;
      const lang = el.dataset.lang;
      const src = el.textContent ?? "";
      let tokens;
      if (lang === "xml") tokens = tokenizeXml(src);
      else if (lang === "ts" || lang === "typescript") tokens = tokenizeTs(src);
      else if (lang === "bash" || lang === "sh") tokens = tokenizeBash(src);
      else continue;
      applyTokens(el, tokens);
      el.dataset.highlighted = "1";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", highlightAll);
  } else {
    highlightAll();
  }

  // ---------- theme toggle ----------
  // Three states cycle: auto (no override) → light → dark → auto.
  // Auto means the page follows `prefers-color-scheme`; the inline
  // bootstrapper in <head> reads `localStorage.sg-theme` before paint
  // to avoid a flash of the wrong theme.
  const root = document.documentElement;
  const toggles = document.querySelectorAll("[data-theme-toggle]");

  function applyTheme(value) {
    if (value === "light" || value === "dark") {
      root.setAttribute("data-theme", value);
    } else {
      root.removeAttribute("data-theme");
    }
    for (const btn of toggles) {
      const label =
        value === "light"
          ? "Switch to dark theme"
          : value === "dark"
            ? "Switch to system theme"
            : "Switch to light theme";
      btn.setAttribute("aria-label", label);
      btn.setAttribute("data-theme-state", value);
    }
  }

  applyTheme(localStorage.getItem("sg-theme") ?? "auto");

  for (const btn of toggles) {
    btn.addEventListener("click", () => {
      const current = localStorage.getItem("sg-theme") ?? "auto";
      const next =
        current === "auto" ? "light" : current === "light" ? "dark" : "auto";
      if (next === "auto") localStorage.removeItem("sg-theme");
      else localStorage.setItem("sg-theme", next);
      applyTheme(next);
    });
  }

  // ---------- playground iframe overlay ----------
  // Only present on pages that include the dialog element.
  const playgroundDialog = document.getElementById("playground-dialog");
  if (playgroundDialog) {
    const frame = playgroundDialog.querySelector(".playground-dialog-frame");
    const playgroundUrl =
      playgroundDialog.dataset.playgroundUrl ?? "./playground/";

    function openDialog() {
      if (!frame.getAttribute("src")) frame.setAttribute("src", playgroundUrl);
      if (typeof playgroundDialog.showModal === "function") {
        playgroundDialog.showModal();
      } else {
        playgroundDialog.setAttribute("open", "");
      }
      document.body.classList.add("playground-open");
    }

    function closeDialog() {
      if (typeof playgroundDialog.close === "function") {
        playgroundDialog.close();
      } else {
        playgroundDialog.removeAttribute("open");
      }
      document.body.classList.remove("playground-open");
    }

    document.querySelectorAll("[data-open-playground]").forEach((el) => {
      el.addEventListener("click", (event) => {
        // Preserve middle-click / cmd-click / ctrl-click "open in new
        // tab" — only intercept the plain primary click.
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        openDialog();
      });
    });

    playgroundDialog.addEventListener("click", (event) => {
      if (event.target === playgroundDialog) closeDialog();
    });

    document.querySelectorAll("[data-close-playground]").forEach((el) => {
      el.addEventListener("click", () => closeDialog());
    });

    playgroundDialog.addEventListener("close", () => {
      document.body.classList.remove("playground-open");
    });
  }

  // ---------- screenshot lightbox ----------
  const lightbox = document.getElementById("lightbox-dialog");
  if (lightbox) {
    const image = lightbox.querySelector(".lightbox-image");
    const caption = lightbox.querySelector(".lightbox-caption");
    const triggers = Array.from(document.querySelectorAll("[data-lightbox]"));
    let index = 0;

    function show(i) {
      if (triggers.length === 0) return;
      index = (i + triggers.length) % triggers.length;
      const trigger = triggers[index];
      image.setAttribute("src", trigger.getAttribute("href"));
      const alt = trigger.querySelector("img")?.alt ?? "";
      image.setAttribute("alt", alt);
      caption.textContent = trigger.getAttribute("data-caption") ?? alt;
    }

    function open(i) {
      show(i);
      if (typeof lightbox.showModal === "function") {
        lightbox.showModal();
      } else {
        lightbox.setAttribute("open", "");
      }
      document.body.classList.add("lightbox-open");
    }

    function close() {
      if (typeof lightbox.close === "function") {
        lightbox.close();
      } else {
        lightbox.removeAttribute("open");
      }
      document.body.classList.remove("lightbox-open");
      image.removeAttribute("src");
    }

    triggers.forEach((trigger, i) => {
      trigger.addEventListener("click", (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        open(i);
      });
    });

    lightbox.addEventListener("click", (event) => {
      const t = event.target;
      if (
        t === lightbox ||
        t.classList.contains("lightbox-figure") ||
        t.classList.contains("lightbox-caption")
      ) {
        close();
      }
    });

    document
      .querySelectorAll("[data-close-lightbox]")
      .forEach((el) => el.addEventListener("click", close));

    document.querySelectorAll("[data-lightbox-nav]").forEach((el) =>
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        const dir = Number.parseInt(
          el.getAttribute("data-lightbox-nav") ?? "1",
          10,
        );
        show(index + dir);
      }),
    );

    document.addEventListener("keydown", (event) => {
      if (!lightbox.hasAttribute("open")) return;
      if (event.key === "ArrowRight") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
    });

    lightbox.addEventListener("close", () => {
      document.body.classList.remove("lightbox-open");
      image.removeAttribute("src");
    });
  }
})();
