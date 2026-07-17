import type { SVGProps } from "react";

export function MarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" {...props}>
      <path d="M18 2 33 10v16l-15 8L3 26V10L18 2Z" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m10 22 8-14 8 14h-6l-2-4-2 4h-6Z" fill="currentColor" />
    </svg>
  );
}

export function TrendLine() {
  return (
    <svg className="trend-line" viewBox="0 0 720 220" preserveAspectRatio="none" role="img" aria-label="Latency rose sharply from 390 to 1,842 milliseconds in the last ten minutes">
      <defs>
        <pattern id="grid" width="120" height="44" patternUnits="userSpaceOnUse">
          <path d="M 120 0 L 0 0 0 44" fill="none" stroke="rgba(255,255,255,.08)" strokeDasharray="4 5" />
        </pattern>
      </defs>
      <rect width="720" height="220" fill="url(#grid)" />
      <path className="trend-shadow" d="M0 184 C40 177 60 188 92 179 S145 185 178 177 S235 186 268 181 S320 189 353 177 S409 184 444 179 S500 184 540 176 S588 184 610 170 C638 151 644 94 655 65 S677 39 690 22 S707 18 720 13" />
      <path className="trend-stroke" d="M0 184 C40 177 60 188 92 179 S145 185 178 177 S235 186 268 181 S320 189 353 177 S409 184 444 179 S500 184 540 176 S588 184 610 170 C638 151 644 94 655 65 S677 39 690 22 S707 18 720 13" />
      <circle className="trend-dot" cx="720" cy="13" r="5" />
    </svg>
  );
}

