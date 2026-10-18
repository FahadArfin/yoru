import React, { useMemo, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Clock3, ExternalLink, Eye, List, Star, Users } from 'lucide-react';
import { groupChapterEditions } from './chapter-groups';
import { languageName } from './model';
import PrefetchLink from '../PrefetchLink';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export const languageLabel = (code) =>
  ({ 'es-la': 'Spanish (Latin America)', 'zh-hk': 'Chinese (Traditional)' })[code] ||
  languageName(code);
const flags = {
  en: 'gb',
  ja: 'jp',
  ko: 'kr',
  es: 'es',
  'es-la': 'mx',
  'pt-br': 'br',
  pt: 'pt',
  fr: 'fr',
  de: 'de',
  it: 'it',
  ru: 'ru',
  uk: 'ua',
  zh: 'cn',
  'zh-hk': 'hk',
  id: 'id',
  vi: 'vn',
  th: 'th',
  tr: 'tr',
  pl: 'pl',
};
const chapterLabel = (item) => (item.number ? `Chapter ${item.number}` : 'Special chapter');
function dateLabel(value) {
  const days = (Date.parse(value) - Date.now()) / 86400000;
  if (!Number.isFinite(days)) return '';
  if (Math.abs(days) >= 365) return relative.format(Math.trunc(days / 365), 'year');
  if (Math.abs(days) >= 30) return relative.format(Math.trunc(days / 30), 'month');
  if (Math.abs(days) >= 1) return relative.format(Math.trunc(days), 'day');
  return relative.format(Math.trunc(days * 24), 'hour');
}
function Edition({ item, opened, rate, nested }) {
  const ChapterLink = item.native ? PrefetchLink : 'a';
  return (
    <article className={`live-chapter-row${nested ? ' nested-edition' : ''}`}>
      <ChapterLink
        className="live-chapter-link"
        {...(item.native ? { to: item.readUrl } : { href: item.readUrl })}
        target={item.native ? undefined : '_blank'}
        rel="noopener noreferrer"
        onClick={() => opened(item)}
        onAuxClick={(e) => {
          if (e.button === 1) opened(item);
        }}
      >
        <span className="chapter-edition-copy">
          <strong>
            <span className="chapter-language" title={languageLabel(item.language)}>
              {flags[item.language] && (
                <img src={`/flags/${flags[item.language]}.png`} alt="" width="18" height="12" />
              )}
              <span className="chapter-language-name">{languageLabel(item.language)}</span>
            </span>
            <span>
              {nested
                ? item.title || chapterLabel(item)
                : `Ch. ${item.number || 'Special'}${item.title ? ` – ${item.title}` : ''}`}
            </span>
          </strong>
          <span className="chapter-edition-meta">
            <Users size={13} />
            <span>{item.groups.map((g) => g.name).join(', ') || 'No group credited'}</span>
            <span className="chapter-read-provider">
              {item.readLabel}
              {item.native ? <BookOpen size={11} /> : <ExternalLink size={11} />}
            </span>
          </span>
        </span>
      </ChapterLink>
      <span className="chapter-edition-date">
        {item.publishedAt && (
          <time dateTime={item.publishedAt} title={new Date(item.publishedAt).toLocaleString()}>
            <Clock3 size={13} />
            {dateLabel(item.publishedAt)}
          </time>
        )}
        <span>
          {item.pages > 0
            ? `${item.pages} pages`
            : item.native
              ? 'Read in Yoru'
              : `Read on ${item.readLabel}`}
        </span>
      </span>
      <div className="chapter-activity">
        <span
          className="chapter-open-count"
          title="Chapter opens from Yoru, counted once per browser while its visitor cookie is kept."
        >
          <Eye size={14} />
          {compact.format(item.stats?.opens || 0)}
          <span className="sr-only"> opens on Yoru</span>
        </span>
        <button
          className={`chapter-rating${item.stats?.myRating ? ' rated' : ''}`}
          onClick={() => rate(item)}
          aria-label={`Rate ${chapterLabel(item)} in ${languageLabel(item.language)}`}
          title={
            item.stats?.votes
              ? `${item.stats.votes} Yoru ratings · ${item.stats.rating.toFixed(1)} out of 5`
              : 'Be the first to rate this edition'
          }
        >
          <Star size={14} fill={item.stats?.myRating ? 'currentColor' : 'none'} />
          {item.stats?.votes ? item.stats.rating.toFixed(1) : 'Rate'}
        </button>
      </div>
    </article>
  );
}
export default function ChapterDirectory({ items, sort, opened, rate }) {
  const volumes = useMemo(() => groupChapterEditions(items, sort), [items, sort]);
  const refs = useRef(new Map());
  const [indexOpen, setIndexOpen] = useState(false);
  return (
    <div className="chapter-directory">
      <div className="chapter-directory-tools">
        <span>
          {volumes.length} {volumes.length === 1 ? 'volume group' : 'volume groups'}
        </span>
        <button onClick={() => setIndexOpen(!indexOpen)} aria-expanded={indexOpen}>
          <List size={16} />
          Index
        </button>
      </div>
      {indexOpen && (
        <nav className="chapter-volume-index" aria-label="Volume index">
          {volumes.map((volume) => (
            <button
              key={volume.key}
              onClick={() => {
                const element = refs.current.get(volume.key);
                if (element) {
                  element.open = true;
                  element.scrollIntoView({ block: 'start', behavior: 'instant' });
                  element.querySelector('summary')?.focus({ preventScroll: true });
                }
              }}
            >
              {volume.label}
            </button>
          ))}
        </nav>
      )}
      <div className="live-chapter-rows">
        {volumes.map((volume) => {
          const numbers = volume.chapters
            .map((c) => Number(c.number))
            .filter((n, i) => volume.chapters[i].number !== null && Number.isFinite(n));
          const range = numbers.length
            ? `Ch. ${Math.min(...numbers)}${Math.max(...numbers) !== Math.min(...numbers) ? ` – ${Math.max(...numbers)}` : ''}`
            : 'Special chapters';
          return (
            <details
              className="chapter-volume"
              key={volume.key}
              open
              ref={(node) => {
                if (node) refs.current.set(volume.key, node);
                else refs.current.delete(volume.key);
              }}
            >
              <summary>
                <strong>{volume.label}</strong>
                <span>{range}</span>
                <span>
                  {volume.count}
                  <ChevronDown size={16} />
                </span>
              </summary>
              <div className="chapter-volume-rows">
                {volume.chapters.map((chapter) =>
                  chapter.items.length > 1 ? (
                    <details className="chapter-translation-group" key={chapter.key} open>
                      <summary>
                        <strong>Chapter {chapter.number}</strong>
                        <span>
                          {chapter.items.length} translations
                          <ChevronDown size={14} />
                        </span>
                      </summary>
                      {chapter.items.map((item) => (
                        <Edition key={item.id} item={item} opened={opened} rate={rate} nested />
                      ))}
                    </details>
                  ) : (
                    <Edition
                      key={chapter.key}
                      item={chapter.items[0]}
                      opened={opened}
                      rate={rate}
                    />
                  ),
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
