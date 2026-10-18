import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, ArrowRight } from 'lucide-react';
import { Button, Modal } from './components';

export default function RoomInvite({ close, inviteUrl, created = false }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const url = new URL(inviteUrl, window.location.origin).href;
  return (
    <Modal title="Invite friends" close={close}>
      <span className="eyebrow">SAVE THEM A SEAT</span>
      <h2>{created ? 'Your room is ready.' : 'Bring your people.'}</h2>
      <p className="muted">Share this link. Friends can sign in and join you directly.</p>
      <label>
        Room invitation
        <input
          className="room-share-link"
          aria-label="Room invitation"
          value={url}
          readOnly
          onFocus={(e) => e.target.select()}
        />
      </label>
      {error && <p role="status">{error}</p>}
      <div className="room-share-actions">
        <Button
          variant="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setError('');
            } catch {
              setError('Select the invitation above and copy it to share.');
            }
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
          {copied ? 'Copied' : 'Copy invitation'}
        </Button>
        {created && (
          <Link className="btn btn-primary" to={inviteUrl} onClick={close}>
            Enter room
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </Modal>
  );
}
