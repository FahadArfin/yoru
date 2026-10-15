import React from 'react';
import { BookOpen, Columns2, GalleryVertical, RectangleVertical } from 'lucide-react';
import { Modal } from '../components';

export default function ReaderSettings({ preferences, onChange, close }) {
  const paged = ['single', 'double'].includes(preferences.mode);
  const update = (key, value) =>
    onChange({
      ...preferences,
      [key]: value,
      ...(key === 'mode' && ['vertical', 'webtoon'].includes(value) && preferences.fit === 'height'
        ? { fit: 'width' }
        : {}),
    });
  return (
    <Modal title="Reader settings" close={close}>
      <span className="eyebrow">MAKE YOURSELF COMFORTABLE</span>
      <h2>Your reading space.</h2>
      <p className="muted">Remembered for this title, on this device.</p>
      <div className="reader-mode-options" role="group" aria-label="Reading layout">
        {[
          ['single', 'Single page', BookOpen],
          ['double', 'Double page', Columns2],
          ['vertical', 'Vertical', GalleryVertical],
          ['webtoon', 'Webtoon', RectangleVertical],
        ].map(([value, label, Icon]) => (
          <button
            key={value}
            aria-pressed={preferences.mode === value}
            onClick={() => update('mode', value)}
          >
            <Icon size={22} />
            {label}
          </button>
        ))}
      </div>
      <div className="form-stack">
        <div className="reader-form-grid">
          <label>
            Reading direction
            <select
              aria-label="Reading direction"
              value={preferences.direction}
              onChange={(e) => update('direction', e.target.value)}
            >
              <option value="rtl">Right to left</option>
              <option value="ltr">Left to right</option>
            </select>
          </label>
          <label>
            Image fit
            <select
              aria-label="Image fit"
              value={preferences.fit}
              onChange={(e) => update('fit', e.target.value)}
            >
              <option value="width">Fit width</option>
              <option value="height" disabled={!paged}>
                Fit height (paged)
              </option>
              <option value="original">Original size</option>
            </select>
          </label>
        </div>
        <label>
          Reader width <span>{preferences.width} px</span>
          <input
            aria-label="Reader width"
            type="range"
            min="400"
            max="1600"
            step="50"
            value={preferences.width}
            onChange={(e) => update('width', Number(e.target.value))}
          />
        </label>
        <label>
          Background
          <select
            aria-label="Background"
            value={preferences.background}
            onChange={(e) => update('background', e.target.value)}
          >
            <option value="dark">Midnight</option>
            <option value="black">Pure black</option>
            <option value="sepia">Warm paper</option>
            <option value="light">Light paper</option>
          </select>
        </label>
        {preferences.mode === 'vertical' && (
          <label>
            Space between pages <span>{preferences.gap} px</span>
            <input
              aria-label="Page gap"
              type="range"
              min="0"
              max="48"
              step="4"
              value={preferences.gap}
              onChange={(e) => update('gap', Number(e.target.value))}
            />
          </label>
        )}
      </div>
      <div className="reader-shortcuts">
        <strong>Keyboard shortcuts</strong>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd> Turn pages in your reading direction
        </span>
        <span>
          <kbd>Space</kbd> Next page <kbd>Shift Space</kbd> Previous
        </span>
        <span>
          <kbd>B</kbd> Bookmark <kbd>S</kbd> Settings <kbd>F</kbd> Focus
        </span>
        <span>
          <kbd>Esc</kbd> Close panel or leave focus mode
        </span>
      </div>
    </Modal>
  );
}
