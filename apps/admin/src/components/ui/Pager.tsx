type PagerProps = {
  page: number;
  totalPages: number;
  summary: string;
  prevLabel: string;
  nextLabel: string;
  onPrev: () => void;
  onNext: () => void;
};

export function Pager({ page, totalPages, summary, prevLabel, nextLabel, onPrev, onNext }: PagerProps) {
  const maxPages = Math.max(totalPages, 1);
  return (
    <div className="pager">
      <span className="panel-meta">{summary}</span>
      <div className="topbar-actions">
        <button className="ghost" type="button" disabled={page <= 1} onClick={onPrev}>
          {prevLabel}
        </button>
        <button className="ghost" type="button" disabled={page >= maxPages} onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}
