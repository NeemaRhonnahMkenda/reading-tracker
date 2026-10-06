// src/app/diary/_components/GoalRing.tsx

import { ReactNode } from "react";

export default function GoalRing({
  value,
  goal,
  size = 112,
  stroke = 7,
  children,
}: {
  value: number;
  goal: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = goal > 0 ? Math.min(value / goal, 1) : 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${goal} minutes read today`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#0f172a" strokeOpacity={0.07} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={progress >= 1 ? "#c5a24a" : "#7a947c"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1), stroke 300ms" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
