import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Gear } from "@phosphor-icons/react";
import { SettingsDialog, t, subscribeLocale } from "@slideglance/viewer";

// 128px icon shipped with the extension. The Vite asset pipeline
// resolves `public/*` references to a hashed URL the rendered HTML
// can load directly. Using the icon avoids the lowercase `slideglance
// viewer` text logo that previously sat in the empty state — the
// product name everywhere else now reads "SlideGlance PPTX Viewer".
import iconUrl from "../../public/icon-128.png";

/** User-visible product name, shown beneath the icon. Kept in sync
 * with the manifest `name` and the Web Store listing so the user
 * sees one brand everywhere. The context-menu label stays terse
 * ("Open with SlideGlance") for the same reason VS Code commands
 * use the short prefix — verb phrases in chrome surfaces read
 * better without the trailing product noun. */
const PRODUCT_NAME = "SlideGlance PPTX Viewer";

interface EmptyStateProps {
  onFile: (file: File) => void;
}

export function EmptyState({ onFile }: EmptyStateProps): JSX.Element {
  const [hover, setHover] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Re-render the empty state when the active locale changes so the
  // body / button labels reflect the new language without requiring
  // the user to load a deck first.
  const [, setLocaleTick] = useState(0);
  useEffect(() => subscribeLocale(() => setLocaleTick((n) => n + 1)), []);

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault();
      setHover(false);
      const file = ev.dataTransfer.files[0];
      if (file && file.name.toLowerCase().endsWith(".pptx")) {
        onFile(file);
      }
    },
    [onFile],
  );

  const onPick = useCallback(
    (ev: React.ChangeEvent<HTMLInputElement>) => {
      const file = ev.target.files?.[0];
      if (file) onFile(file);
    },
    [onFile],
  );

  return (
    <div
      style={hover ? { ...wrapperStyle, ...wrapperHoverStyle } : wrapperStyle}
      onDragOver={(ev) => {
        ev.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={onDrop}
    >
      {/* Settings access — without this the user can't change language
          (or theme) on a fresh tab where no deck is loaded yet. */}
      <button
        style={settingsButtonStyle}
        onClick={() => setSettingsOpen(true)}
        title={t("dialog.title")}
        aria-label={t("dialog.title")}
      >
        <Gear size={18} weight="regular" />
      </button>
      <div style={cardStyle}>
        <img src={iconUrl} alt={PRODUCT_NAME} style={iconStyle} />
        <h1 style={titleStyle}>{PRODUCT_NAME}</h1>
        <p style={bodyStyle}>{t("viewer.empty")}</p>
        <button style={buttonStyle} onClick={() => inputRef.current?.click()}>
          {t("viewer.openFile")}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".pptx"
          style={{ display: "none" }}
          onChange={onPick}
        />
      </div>
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  position: "relative",
  display: "grid",
  placeItems: "center",
  width: "100%",
  height: "100%",
  background: "var(--pptx-shell-bg, #0e0e10)",
  color: "var(--pptx-shell-fg, #ececec)",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const wrapperHoverStyle: CSSProperties = {
  outline: "2px dashed var(--pptx-shell-accent, #6aa3ff)",
  outlineOffset: -16,
};

const cardStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
  padding: "32px 48px",
  border: "1px solid var(--pptx-shell-border, #2a2a30)",
  borderRadius: 8,
  background: "var(--pptx-shell-ribbon-bg, #1f1f23)",
};

const iconStyle: CSSProperties = {
  width: 96,
  height: 96,
  // Slight lift between the icon and the title; the title sits
  // immediately under it so the brand reads as one unit.
  marginBottom: 4,
  imageRendering: "auto",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.01em",
};

const bodyStyle: CSSProperties = {
  margin: 0,
  fontSize: 14,
  color: "var(--pptx-shell-status, #999)",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  background: "var(--pptx-shell-accent-soft, #25304a)",
  color: "var(--pptx-shell-fg, #ececec)",
  border: "1px solid var(--pptx-shell-accent, #6aa3ff)",
  padding: "8px 20px",
  borderRadius: 4,
  font: "inherit",
  fontSize: 14,
  cursor: "pointer",
};

const settingsButtonStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 32,
  height: 32,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  color: "var(--pptx-shell-fg, #ececec)",
  border: "1px solid var(--pptx-shell-border, #2a2a30)",
  borderRadius: 4,
  cursor: "pointer",
  padding: 0,
};
