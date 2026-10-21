import React, { useEffect, useState } from 'react';
import { Modal, ErrorNotice, Button } from '../components';
import ChapterList from './ChapterList';
import { chapterList, readerContextKey } from './requests';

// Source selection is only a preview. The current URL and progress remain pinned
// until the reader explicitly selects a verified edition from this list.
export default function ReaderEditionPicker({
  mediaId,
  source,
  context,
  localItems = [],
  onSelect,
  close,
}) {
  const [language, setLanguage] = useState(source.sourceRef?.language || 'en');
  const [revision, setRevision] = useState(0);
  const [request, setRequest] = useState(null);
  const [state, setState] = useState({ key: '', items: [], loading: true, error: '' });
  const key = `${readerContextKey(context)}:${source.mediaId || mediaId}:${source.id}:${language}`;
  const position = request?.key === key ? request : { page: 1, offset: 0 };
  useEffect(() => {
    const controller = new AbortController();
    setState((old) => ({ key, items: old.key === key ? old.items : [], loading: true, error: '' }));
    if (source.id === 'local') {
      setState({ key, items: localItems, loading: false, error: '' });
      return () => controller.abort();
    }
    if (!context) return () => controller.abort();
    chapterList(
      source.mediaId || mediaId,
      {
        source: source.id,
        sourceRef: source.sourceRef,
        language,
        sort: 'asc',
        page: position.page,
        offset: position.offset,
      },
      { ...context, signal: controller.signal },
      revision > 0,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setState((old) => ({
          key,
          loading: false,
          error: '',
          data: result,
          items: [
            ...new Map(
              [
                ...(position.page > 1 || position.offset > 0 ? old.items : []),
                ...(result.items || [])
                  .filter((c) => c.native && !c.external)
                  .map((c) => ({
                    ...c,
                    kind: 'remote',
                    mediaId: c.mediaId || source.mediaId || mediaId,
                    sourceRef: c.sourceRef || source.sourceRef,
                    source: c.source || source.id,
                    group: c.groups?.map((g) => g.name).join(', ') || c.readLabel || '',
                    pageCount: c.pageCount || c.pages,
                    pages: [],
                  })),
              ].map((item) => [item.id, item]),
            ).values(),
          ],
        }));
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState((old) => ({ ...old, key, loading: false, error: error.message }));
      });
    return () => controller.abort();
  }, [key, revision, position.page, position.offset]);
  const current = state.key === key ? state : { items: [], loading: true };
  return (
    <Modal title="Choose an exact edition" close={close} wide>
      <h2>{source.name || source.sourceRef?.providerKey || 'Reading source'}</h2>
      <p>Your current chapter stays open until you choose an edition.</p>
      {current.error && (
        <ErrorNotice message={current.error} retry={() => setRevision((n) => n + 1)} />
      )}
      {!current.loading && !current.items.length && (
        <p role="status">
          No verified edition is available from this source. Your current edition is unchanged.
        </p>
      )}
      <ChapterList
        chapters={current.items}
        onSelect={onSelect}
        remote={source.id !== 'local'}
        loading={current.loading}
        language={source.id === 'local' ? undefined : language}
        languages={current.data?.languages || [source.sourceRef?.language].filter(Boolean)}
        onLanguageChange={source.id === 'local' ? undefined : setLanguage}
      />
      {(current.data?.nextPage != null || current.data?.nextOffset != null) && (
        <Button
          disabled={current.loading}
          onClick={() =>
            setRequest({
              key,
              page: current.data.nextPage ?? 1,
              offset: current.data.nextOffset ?? 0,
            })
          }
        >
          {current.loading ? 'Loading editions…' : 'Load more verified editions'}
        </Button>
      )}
      <Button variant="subtle" onClick={close}>
        Keep current edition
      </Button>
    </Modal>
  );
}
