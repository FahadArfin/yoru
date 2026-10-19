import React from 'react';

export default function CatalogIntegrationSelect({
  value = 'all',
  onChange,
  disabled = false,
  className = '',
}) {
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
