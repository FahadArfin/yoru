import React from 'react';

export default function CatalogIntegrationSelect({
  value = 'all',
  onChange,
  disabled = false,
  className = '',
  buttons = false,
}) {
  if (buttons)
    return (
      <div className="catalog-integration-toggle" role="group" aria-label="Catalog integration">
        {[
          ['extensions', 'Suwayomi extensions'],
          ['core', 'MangaDex + Weeb Central'],
          ['all', 'All sources'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className="btn btn-subtle"
            aria-pressed={value === mode}
            disabled={disabled}
            onClick={() => value !== mode && onChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    );
  return (
    <label className={`reader-list-filter ${className}`}>
      <span>Catalog integration</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All sources</option>
        <option value="core">MangaDex + Weeb Central</option>
        <option value="extensions">Suwayomi extensions</option>
      </select>
    </label>
  );
}
