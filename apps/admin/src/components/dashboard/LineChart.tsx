export default function LineChart({ labels, points, max }: { labels: string[]; points: number[]; max: number }) {
  const width = 640;
  const height = 260;
  const paddingX = 34;
  const paddingTop = 14;
  const paddingBottom = 36;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingTop - paddingBottom;
  const safePoints = points.length > 1 ? points : [0, 0];
  const path = safePoints.map((value, index) => {
    const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
    const y = paddingTop + innerHeight - (Math.max(0, Math.min(max, value)) / max) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  const yTicks = [0, 2, 4, 6, 8, 10];

  return (
    <>
      <svg className="queue-chart" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        {yTicks.map((tick) => {
          const y = paddingTop + innerHeight - (tick / max) * innerHeight;
          return (
            <g key={tick}>
              <line className="chart-grid-line" x1={paddingX} x2={width - paddingX} y1={y} y2={y} />
              <text className="chart-y-label" x={paddingX - 22} y={y + 5}>{tick}</text>
            </g>
          );
        })}
        <path className="chart-line" d={path} />
        {safePoints.map((value, index) => {
          const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
          const y = paddingTop + innerHeight - (Math.max(0, Math.min(max, value)) / max) * innerHeight;
          return <circle key={labels[index] ?? String(index)} className="chart-point" cx={x} cy={y} r={4.5} />;
        })}
      </svg>
      <div className="chart-x-labels">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </>
  );
}
