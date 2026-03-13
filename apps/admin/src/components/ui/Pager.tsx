type PagerProps = {
  page: number;
  totalPages: number;
  summary: string;
  prevLabel: string;
  nextLabel: string;
  onPageChange?: (page: number) => void;
  onPrev: () => void;
  onNext: () => void;
};

function buildVisiblePages(page: number, totalPages: number) {
  const maxPages = Math.max(totalPages, 1);
  if (maxPages <= 5) return Array.from({ length: maxPages }, (_, index) => index + 1);

  if (page <= 3) return [1, 2, 3, 4, maxPages];
  if (page >= maxPages - 2) return [1, maxPages - 3, maxPages - 2, maxPages - 1, maxPages];
  return [1, page - 1, page, page + 1, maxPages];
}

export function Pager({ page, totalPages, summary, prevLabel, nextLabel, onPageChange, onPrev, onNext }: PagerProps) {
  const maxPages = Math.max(totalPages, 1);
  const visiblePages = buildVisiblePages(page, maxPages);

  return (
    <div className="pager">
      <span className="panel-meta">{summary}</span>
      <div className="pager-actions">
        <button className="ghost" type="button" disabled={page <= 1} onClick={onPrev}>
          {prevLabel}
        </button>
        {visiblePages.map((visiblePage) => (
          <button
            key={visiblePage}
            className={`ghost pager-page-btn ${visiblePage === page ? "is-active" : ""}`}
            type="button"
            disabled={visiblePage === page}
            onClick={() => onPageChange?.(visiblePage)}
          >
            {visiblePage}
          </button>
        ))}
        <button className="ghost" type="button" disabled={page >= maxPages} onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
