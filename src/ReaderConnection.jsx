import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, RefreshCw } from 'lucide-react';
import { Link } from './collection-router';
import { discoverCatalogs, browseCatalog, normalizeServerUrl } from '../shared/reader-connection';

const KEY = 'yoru:reader-catalogs:v1';
function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
export default function ReaderConnection() {
  const [mode, setMode] = useState('yoru');
  const [url, setUrl] = useState(() => saved().url || '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [connection, setConnection] = useState(null);
  const [sources, setSources] = useState([]);
  const [enabled, setEnabled] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [selection, setSelection] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [offset, setOffset] = useState(0);
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
  const persist = (address, values) => {
    try {
      const data = saved();
      localStorage.setItem(
        KEY,
        JSON.stringify({ url: address, enabled: { ...data.enabled, [address]: values } }),
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
      <p>Connect to Suwayomi to discover supported non-explicit catalogs.</p>
      <div className="reader-connection-modes" role="group" aria-label="Reader server">
        <button
          type="button"
          className="btn btn-subtle"
          aria-pressed={mode === 'yoru'}
          onClick={() => {
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
              ? ` · ${sources.length} supported ${sources.length === 1 ? 'catalog' : 'catalogs'}`
              : ' · No supported online catalogs installed.'}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {storageError && <p role="alert">{storageError}</p>}
      {connection && !sources.length && (
        <p>
          Local files, mixed-content and adult catalogs are excluded. You can connect another server
          with a supported catalog.
        </p>
      )}
      {sources.map((source) => (
        <div className="setting-row" key={source.id}>
          <div>
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
                disabled={!enabled[source.id] || busy}
                onClick={() => {
                  setQuery('');
                  browse(source.id, 0, '');
                }}
              >
                Browse {source.name}
              </button>
            </div>
          )}
        </div>
      ))}
      {mode === 'custom' && connection && sources.length > 0 && (
        <p className="small">
          Switches control browsing here on this device. They don’t install or uninstall extensions,
          change Yoru’s main catalog, or change its chapter providers.
        </p>
      )}
      {mode === 'yoru' && connection && (
        <p className="small">
          Yoru manages its chapter providers automatically. This connection check does not expose
          the server’s private library.
        </p>
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
