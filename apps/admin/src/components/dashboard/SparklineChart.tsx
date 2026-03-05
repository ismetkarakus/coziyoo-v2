export default function SparklineChart({ labels, points }: { labels: string[]; points: number[] }) {
  const width = 720;
  const height = 120;
  const paddingX = 10;
  const paddingY = 12;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = Math.max(max - min, 1);
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  const safePoints = points.length > 1 ? points : [0, 0];
  const linePath = safePoints.map((value, index) => {
    const x = paddingX + (index / (safePoints.length - 1)) * innerWidth;
    const y = paddingY + innerHeight - ((value - min) / range) * innerHeight;
    return `${index === 0 ? "M" : "L"}${x},${y}`;
  }).join(" ");
  const areaPath = `${linePath} L ${width - paddingX},${height - paddingY} L ${paddingX},${height - paddingY} Z`;

  return (
    <>
      <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(96, 157, 255, 0.4)" />
            <stop offset="100%" stopColor="rgba(96, 157, 255, 0.05)" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-fill)" />
        <path className="chart-line" d={linePath} />
      </svg>
      <div className="chart-x-labels spark-x-labels">
        {labels.map((label) => <span key={label}>{label}</span>)}
      </div>
    </>
  );
}
