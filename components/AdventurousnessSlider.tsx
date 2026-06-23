"use client";

type AdventurousnessSliderProps = {
  value: number;
  onChange: (value: number) => void;
};

export default function AdventurousnessSlider({
  value,
  onChange,
}: AdventurousnessSliderProps) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor="adventurousness" className="text-sm text-muted">
          Adventurousness
        </label>
        <span className="font-mono text-sm text-neon">{value}</span>
      </div>
      <input
        id="adventurousness"
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-neon"
      />
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>Familiar</span>
        <span>Surprising</span>
      </div>
    </div>
  );
}
