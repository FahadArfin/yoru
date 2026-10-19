import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { Link } from './collection-router';
import { useCollection } from './collection-context';
import useCatalogPreferences, { useReaderSelection } from './useCatalogPreferences';
import CatalogIntegrationSelect from './CatalogIntegrationSelect';
import { catalogEnabled } from '../shared/catalog-preferences';
import { migrateGuestCatalogPreferences } from './reader/catalog-preferences';
import { discoverCatalogs, browseCatalog, normalizeServerUrl } from '../shared/reader-connection';

const KEY = 'yoru:reader-catalogs:v1';
const languageName = (code) => {
  if (code === 'all') return 'Multilingual';
  if (code === 'other') return 'Other';
  if (!code) return 'Unspecified';
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
};
function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
export default function ReaderConnection() {
  const collectionActive = !!useCollection()?.active;
  const preferences = useCatalogPreferences();
  const readerSelection = useReaderSelection();
  const [mode, setMode] = useState('yoru');
  const [url, setUrl] = useState(() => saved().url || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connection, setConnection] = useState(null);
  const [sources, setSources] = useState([]);
  const [enabled, setEnabled] = useState({});
  const [sourceList, setSourceList] = useState(collectionActive ? 'ara-ara' : 'yoru');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [selection, setSelection] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [offset, setOffset] = useState(0);
  const [providerQuery, setProviderQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [catalogStatus, setCatalogStatus] = useState('all');
  const clearFilters = () => {
    setProviderQuery('');
    setLanguage('');
    setCatalogStatus('all');
  };
  const languages = [...new Set(sources.map((source) => source.language))].sort((a, b) =>
    languageName(a).localeCompare(languageName(b)),
  );
  const listEnabled =
    mode === 'yoru'
      ? Object.fromEntries(
          sources.map((s) => [s.id, catalogEnabled(s.name, sourceList, preferences.overrides)]),
        )
      : enabled;
  const filteredSources = sources.filter(
    (source) =>
      source.name.toLocaleLowerCase().includes(providerQuery.trim().toLocaleLowerCase()) &&
      (!language || source.language === language) &&
      (catalogStatus === 'all' ||
        (catalogStatus === 'on' ? listEnabled[source.id] : !listEnabled[source.id])),
  );
  const providers = Array.from(
    filteredSources.reduce((groups, source) => {
      if (!groups.has(source.name)) groups.set(source.name, new Set());
      groups.get(source.name).add(source.language || 'unspecified');
      return groups;
    }, new Map()),
  ).sort(([a], [b]) => a.localeCompare(b));
  const pending = useRef(null);
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
  };
  const reset = () => {
    cancel();
    setConnection(null);
    setSources([]);
    setSelection('');
    setResults(null);
    setBusy(false);
    setError('');
  };
  const persist = (address, values, araValues) => {
    try {
      const data = saved();
      localStorage.setItem(
        KEY,
        JSON.stringify({
          ...data,
          url: address === 'yoru' ? data.url : address,
          enabled: { ...data.enabled, [address]: values },
          ...(araValues ? { araEnabled: { ...data.araEnabled, [address]: araValues } } : {}),
        }),
      );
      setStorageError('');
    } catch {
      setStorageError(
        'Your browser could not save these choices. They apply until you leave this page.',
      );
    }
  };
  const connect = async (kind = mode) => {
    reset();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const address = kind === 'yoru' ? 'yoru' : normalizeServerUrl(url);
      const authorization =
        username || password
          ? `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}`
          : '';
      let data;
      if (kind === 'yoru') {
        const response = await fetch('/api/reader/catalogs', { signal: controller.signal });
        data = await response.json();
        if (!response.ok)
          throw new Error(data.error || 'Yoru’s reader server is unavailable. Try again.');
      } else data = await discoverCatalogs(address, { signal: controller.signal, authorization });
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.sources))
        throw new Error('The server returned an incompatible catalog list.');
      const values = Object.fromEntries(
        data.sources.map((s) => [s.id, saved().enabled?.[address]?.[s.id] !== false]),
      );
      setSources(data.sources);
      setEnabled(values);
      setConnection({ address, authorization });
      if (kind !== 'yoru') {
        setUrl(address);
        persist(address, values);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  useEffect(() => {
    connect('yoru');
    return cancel;
  }, []);
  useEffect(() => {
    setSourceList(collectionActive ? 'ara-ara' : 'yoru');
  }, [collectionActive]);
  useEffect(() => {
    if (mode !== 'yoru' || !sources.length || preferences.scope !== 'guest') return;
    try {
      migrateGuestCatalogPreferences(sources);
      window.dispatchEvent(new Event('storage'));
    } catch {
      setStorageError('Your browser could not preserve the previous catalog choices.');
    }
  }, [sources, mode, preferences.scope]);
  const toggle = (id) => {
    const values = { ...enabled, [id]: !enabled[id] };
    setEnabled(values);
    persist(connection.address, values);
    if (selection === id) {
      cancel();
      setBusy(false);
      setSelection('');
      setResults(null);
      setError('');
    }
  };
  const providerEnabled = (name, destination) =>
    catalogEnabled(name, destination, preferences.overrides);
  const toggleProvider = (name, destination) => {
    void preferences.change(name, destination, !providerEnabled(name, destination));
  };
  const browse = async (id, start = 0, search = query) => {
    if (!enabled[id] || !connection || mode !== 'custom') return;
    cancel();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setSelection(id);
    setResults(null);
    setError('');
    setOffset(start);
    try {
      const data = await browseCatalog(connection.address, id, search, start, {
        authorization: connection.authorization,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setResults(data);
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return (
    <section
      className="panel settings-card reader-connection"
      aria-labelledby="reader-connection-heading"
    >
      <div className="panel-heading">
        <span className="settings-card-icon">
          <BookOpen size={20} />
        </span>
        <div>
          <span className="settings-label">READING</span>
          <h2 id="reader-connection-heading">Reader catalogs</h2>
        </div>
      </div>
      <p>Choose the reader catalogs you want in Yoru and Ara Ara.</p>
      {mode === 'yoru' && (
        <>
          <label className="reader-list-filter">
            Source list
            <select value={sourceList} onChange={(event) => setSourceList(event.target.value)}>
              <option value="yoru">Yoru</option>
              <option value="ara-ara">Ara Ara</option>
            </select>
          </label>
          <CatalogIntegrationSelect
            value={readerSelection?.context?.modes?.[sourceList] || 'all'}
            disabled={!preferences.scope || !readerSelection?.ready || preferences.saving}
            onChange={(value) => readerSelection.setIntegrationMode(value, sourceList)}
          />
          <p className="small">
            The integration filters browsing and source choices for{' '}
            {sourceList === 'yoru' ? 'Yoru' : 'Ara Ara'}. Provider switches below enable or disable
            each provider independently. Changing an integration keeps your current reading edition
            and progress.
          </p>
          {sourceList === 'ara-ara' &&
            readerSelection?.context?.modes?.['ara-ara'] === 'core' &&
            !['MangaDex', 'Weeb Central'].some((provider) =>
              catalogEnabled(provider, 'ara-ara', preferences.overrides),
            ) && (
              <p className="small">
                MangaDex and Weeb Central are disabled in Ara Ara with your current memberships.
                Enable either provider below or choose another integration.
              </p>
            )}
          {readerSelection?.error && (
            <div>
              <p role="alert">{readerSelection.error}</p>
              <button type="button" className="btn btn-subtle" onClick={readerSelection.refresh}>
                Refresh reader choices
              </button>
            </div>
          )}
        </>
      )}
      <div className="reader-connection-modes" role="group" aria-label="Reader server">
        <button
          type="button"
          className="btn btn-subtle"
          aria-pressed={mode === 'yoru'}
          onClick={() => {
            clearFilters();
            setMode('yoru');
            setPassword('');
            connect('yoru');
          }}
        >
          Use Yoru’s reader server
        </button>
        <button
          type="button"
          className="btn btn-subtle"
          aria-pressed={mode === 'custom'}
          onClick={() => {
            clearFilters();
            reset();
            setMode('custom');
          }}
        >
          Use another server
        </button>
      </div>
      {mode === 'custom' && (
        <form
          className="reader-connection-form"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <label>
            Suwayomi server address
            <input
              value={url}
              onChange={(e) => {
                reset();
                setUrl(e.target.value);
              }}
              placeholder="https://reader.example.com"
              autoComplete="url"
              spellCheck={false}
              maxLength={2048}
            />
          </label>
          <details className="settings-details">
            <summary>Server sign-in (optional)</summary>
            <label>
              Server username
              <input
                value={username}
                onChange={(e) => {
                  reset();
                  setUsername(e.target.value);
                }}
                autoComplete="off"
                maxLength={200}
              />
            </label>
            <label>
              Server password
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  reset();
                  setPassword(e.target.value);
                }}
                autoComplete="off"
                maxLength={500}
              />
            </label>
            <p>
              For servers using Basic authentication. Credentials stay in memory for this visit.
            </p>
          </details>
          <button className="btn btn-primary" disabled={busy} type="submit">
            {busy && !selection ? 'Connecting…' : 'Connect'}
          </button>
          <p>
            A server address is different from an extension repository link. HTTPS and browser
            access must be enabled on your server.
          </p>
        </form>
      )}
      {mode === 'yoru' && (
        <button className="btn btn-subtle" type="button" disabled={busy} onClick={() => connect()}>
          <RefreshCw size={14} />
          {busy ? 'Checking connection…' : 'Refresh connection'}
        </button>
      )}
      <div role="status" aria-live="polite">
        {connection && (
          <p>
            Connected
            {sources.length
              ? ` · ${sources.length} installed ${sources.length === 1 ? 'catalog' : 'catalogs'}`
              : ' · No online catalogs installed.'}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      {mode === 'yoru' && preferences.error && <p role="alert">{preferences.error}</p>}
      {connection && (
        <p className="reader-catalog-note">
          Available catalogs come from the reader server. Each language counts as a separate
          catalog. Assigning a provider to a section does not change that section’s content rules or
          Ara Ara’s age gate. Installed metadata does not verify browsing or reading capabilities.
          New installations can take up to a minute to appear.
        </p>
      )}
      {sources.length > 0 && (
        <>
          <div className="reader-catalog-filters">
            <label className="reader-provider-search">
              Filter providers
              <input
                type="search"
                placeholder="Search providers…"
                value={providerQuery}
                onChange={(event) => setProviderQuery(event.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              Catalog language
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="">All languages</option>
                {languages.filter(Boolean).map((code) => (
                  <option value={code} key={code}>
                    {languageName(code)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Catalog status
              <select
                value={catalogStatus}
                onChange={(event) => setCatalogStatus(event.target.value)}
              >
                <option value="all">All</option>
                <option value="on">Enabled</option>
                <option value="off">Disabled</option>
              </select>
            </label>
          </div>
          <div className="reader-filter-summary">
            <p aria-live="polite">
              {filteredSources.length} of {sources.length} catalogs
            </p>
            {(providerQuery || language || catalogStatus !== 'all') && (
              <button type="button" className="btn btn-subtle" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
          <div
            className="reader-catalog-list"
            role="region"
            aria-label="Installed reader catalogs"
            tabIndex={0}
          >
            {!filteredSources.length && <p>No catalogs match your filters.</p>}
            {mode === 'yoru'
              ? providers.map(([name, languages]) => (
                  <div className="reader-catalog-row" key={name}>
                    <strong>{name}</strong>
                    <div className="reader-provider-controls">
                      <span className="reader-catalog-languages" aria-label={`${name} languages`}>
                        {Array.from(languages)
                          .sort()
                          .map((language) => (
                            <span key={language}>{language}</span>
                          ))}
                      </span>
                      <div
                        className="reader-placement-switches"
                        role="group"
                        aria-label={`${name} list preferences`}
                      >
                        {['yoru', 'ara-ara'].map((destination) => (
                          <button
                            key={destination}
                            type="button"
                            role="switch"
                            disabled={
                              !preferences.scope || !preferences.ready || preferences.saving
                            }
                            aria-checked={providerEnabled(name, destination)}
                            aria-label={`${name} in ${destination === 'yoru' ? 'Yoru' : 'Ara Ara'}`}
                            className="btn btn-subtle"
                            onClick={() => toggleProvider(name, destination)}
                          >
                            <span>{destination === 'yoru' ? 'Yoru' : 'Ara Ara'}</span>
                            <span className="reader-placement-state">
                              {providerEnabled(name, destination) ? 'On' : 'Off'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ))
              : filteredSources.map((source) => (
                  <div className="reader-catalog-row" key={source.id}>
                    <div className="reader-catalog-identity">
                      <strong>{source.name}</strong>
                      <span>{source.language}</span>
                    </div>
                    {mode === 'custom' && (
                      <div className="reader-catalog-actions">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={!!enabled[source.id]}
                          aria-label={`${source.name} catalog`}
                          className="btn btn-subtle"
                          onClick={() => toggle(source.id)}
                        >
                          {enabled[source.id] ? 'On' : 'Off'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-subtle"
                          aria-label={`Browse ${source.name}`}
                          disabled={!enabled[source.id] || busy}
                          onClick={() => {
                            setQuery('');
                            browse(source.id, 0, '');
                          }}
                        >
                          Browse
                        </button>
                      </div>
                    )}
                  </div>
                ))}
          </div>
        </>
      )}
      {mode === 'custom' && connection && sources.length > 0 && (
        <p className="small">
          Switches control browsing here on this device. They don’t install or uninstall extensions,
          change Yoru’s main catalog, or change its chapter providers.
        </p>
      )}
      {mode === 'yoru' && connection && (
        <div>
          <p className="small">
            Choose Yoru, Ara Ara, both, or neither for each provider. Switches apply to all its
            languages throughout the site. Everyone starts with the site defaults.
            {preferences.scope === 'guest'
              ? ' Your changes stay in this browser. Sign in to sync choices across devices.'
              : ' Your personal changes sync with your account across devices.'}{' '}
            New providers start disabled until you choose a list. These choices apply to catalog
            browsing and eligible chapter sources throughout the site; they don’t install extensions
            or establish that an unverified operation is supported. Reset also restores both
            sections’ catalog integrations to All sources.
          </p>
          <button
            type="button"
            className="btn btn-subtle"
            disabled={!preferences.scope || !preferences.ready || preferences.saving}
            onClick={preferences.reset}
          >
            {preferences.saving ? 'Saving choices…' : 'Reset to site defaults'}
          </button>
        </div>
      )}
      {selection && (
        <div className="reader-catalog-results">
          <p>
            Titles already indexed by your server. “Find in Yoru” searches for a matching title.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              browse(selection);
            }}
          >
            <label>
              Search this catalog
              <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100} />
            </label>
            <button className="btn btn-subtle" disabled={busy}>
              Search
            </button>
          </form>
          {busy && <p role="status">Loading titles…</p>}
          {results && (
            <>
              <ul>
                {results.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.title}</span>
                    <Link to={`/browse/manga?q=${encodeURIComponent(item.title)}`}>
                      Find in Yoru
                    </Link>
                  </li>
                ))}
              </ul>
              {!results.items.length && <p>No indexed titles match this page.</p>}
              <div className="reader-catalog-actions">
                <button
                  type="button"
                  className="btn btn-subtle"
                  disabled={!offset || busy}
                  onClick={() => browse(selection, offset - 20)}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-subtle"
                  disabled={!results.hasNextPage || busy}
                  onClick={() => browse(selection, offset + 20)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
