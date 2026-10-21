import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApp } from './state';
import { send } from './api';
import { Button, ErrorNotice } from './components';

export default function AccountSettings() {
  const { user, setUser, config, notify } = useApp();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const callbackError = params.get('authError');
  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await send('/api/auth/chatgpt/connect', { returnTo: '/settings' });
      if (!result.url?.startsWith('/signin-with-chatgpt?'))
        throw new Error('Sign-in could not start.');
      window.location.assign(result.url);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <div className="account-connections">
      {callbackError && (
        <div role="alert">
          <p>{callbackError.slice(0, 500)}</p>
          <button
            className="text-link"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('authError');
              setParams(next, { replace: true });
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {user && (
        <form
          className="form-stack"
          key={user.id}
          onSubmit={async (e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get('name');
            setBusy(true);
            setError('');
            try {
              const result = await send('/api/auth/profile', { name }, 'PATCH');
              setUser(result.user);
              notify('Display name saved');
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Public display name
            <input
              name="name"
              autoComplete="nickname"
              minLength={2}
              maxLength={40}
              defaultValue={user.name}
              required
            />
          </label>
          <Button type="submit" variant="secondary" busy={busy}>
            Save display name
          </Button>
        </form>
      )}
      {config.auth?.chatgpt && (
        <div className="setting-row">
          <div>
            <strong>ChatGPT sign-in</strong>
            <span>
              {user?.chatgptConnected
                ? 'Connected to this Yoru account.'
                : user
                  ? 'Use ChatGPT to sign in to this same account and keep your saved activity.'
                  : 'Use your ChatGPT account, or continue with email and password.'}
            </span>
          </div>
          {user ? (
            user.chatgptConnected ? (
              <span className="badge green">CONNECTED</span>
            ) : (
              <Button variant="secondary" busy={busy} onClick={connect}>
                Connect ChatGPT
              </Button>
            )
          ) : (
            <a
              className="btn btn-secondary"
              target="_top"
              href="/api/auth/chatgpt/start?returnTo=%2Fsettings"
            >
              Continue with ChatGPT
            </a>
          )}
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      <details className="settings-details">
        <summary>What saves to my account?</summary>
        <p>
          Both sign-in methods save your library, favorites, ratings, completion status, watch and
          reading progress, chapter bookmarks and read markers, reviews, comments, replies, votes,
          and community messages.
        </p>
        <p>
          Reader catalog choices also follow your account. Imported chapter files, appearance, and
          device settings stay on this device. Guest activity stays separate until you save it while
          signed in.
        </p>
      </details>
    </div>
  );
}
