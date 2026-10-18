import React, { useState } from 'react';
import { ChevronDown, ChevronUp, UserRound } from 'lucide-react';
import { useResource } from './state';
import './anime-cast.css';

function Portrait({ person }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="cast-portrait">
      {person?.image && !failed ? (
        <img
          src={person.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <UserRound size={22} />
      )}
    </span>
  );
}
export default function AnimeCast({ mediaId }) {
  const { data, loading, error, refresh } = useResource(`/api/media/${mediaId}/cast`);
  const [expanded, setExpanded] = useState(false);
  const [chosen, setChosen] = useState(null);
  const items = data?.items || [];
  const languages = [
    ...new Set(items.flatMap((item) => item.actors.map((actor) => actor.language))),
  ].sort();
  const language = languages.includes(chosen)
    ? chosen
    : languages.includes('Japanese')
      ? 'Japanese'
      : languages[0];
  const visible = expanded ? items : items.slice(0, 12);
  return (
    <section className="anime-cast" aria-label="Character Cast">
      <div className="cast-heading">
        <h2>Character Cast</h2>
        <div>
          {languages.length > 1 && (
            <select
              aria-label="Voice actor language"
              value={language}
              onChange={(e) => setChosen(e.target.value)}
            >
              {languages.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          )}
          {items.length > 0 && <span>{items.length} characters</span>}
        </div>
      </div>
      {loading ? (
        <div className="cast-grid" aria-label="Loading character cast">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="cast-skeleton" key={i} />
          ))}
        </div>
      ) : (
        <>
          {(error || data?.partial) && (
            <p className="cast-note" role="status">
              {items.length
                ? 'Showing the last available cast.'
                : 'Cast details are temporarily unavailable.'}{' '}
              <button onClick={refresh}>Retry</button>
            </p>
          )}
          {!items.length && !error && !data?.partial && (
            <p className="cast-note">Cast details haven’t been announced yet.</p>
          )}
          <div className="cast-grid">
            {visible.map((character) => {
              const actors = character.actors.filter((actor) => actor.language === language);
              return (
                <article className="cast-pair" key={character.id}>
                  <div className="cast-character">
                    <Portrait key={character.image} person={character} />
                    <div>
                      <strong>{character.name}</strong>
                      <small>{character.role}</small>
                    </div>
                  </div>
                  <div className="cast-actors">
                    {actors.length ? (
                      actors.map((actor) => (
                        <div className="cast-actor" key={actor.id}>
                          <div>
                            <strong>{actor.name}</strong>
                            <small>{actor.language}</small>
                          </div>
                          <Portrait key={actor.image} person={actor} />
                        </div>
                      ))
                    ) : (
                      <span className="cast-missing">Voice actor unlisted</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {items.length > 12 && (
            <button
              className="cast-expand"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{' '}
              {expanded ? 'Show less' : `View more (${items.length - 12})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
