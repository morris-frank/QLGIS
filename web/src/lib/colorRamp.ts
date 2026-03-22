const COLOR_STOPS = ["#482878", "#355f8d", "#21918c", "#6ece58", "#fde725"] as const;

export function buildNumericColorExpression(propertyName: string, min: number, max: number, fallbackColor: string): unknown[] | string {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return fallbackColor;
  }

  if (min === max) {
    return COLOR_STOPS[COLOR_STOPS.length - 1];
  }

  const stops = buildColorStops(min, max).flatMap((stop) => [stop.value, stop.color]);
  return ["interpolate", ["linear"], ["to-number", ["get", propertyName], min], ...stops];
}

export function colorizeNormalizedValue(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  const stops = COLOR_STOPS.map((color, index) => ({
    color: hexToRgb(color),
    value: index / (COLOR_STOPS.length - 1)
  }));

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (clamped <= current.value) {
      const segment = (clamped - previous.value) / Math.max(current.value - previous.value, Number.EPSILON);
      return [
        interpolateChannel(previous.color[0], current.color[0], segment),
        interpolateChannel(previous.color[1], current.color[1], segment),
        interpolateChannel(previous.color[2], current.color[2], segment)
      ];
    }
  }

  return hexToRgb(COLOR_STOPS[COLOR_STOPS.length - 1]);
}

export function normalizeValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }

  if (min === max) {
    return 1;
  }

  return (value - min) / (max - min);
}

function buildColorStops(min: number, max: number): Array<{ color: string; value: number }> {
  return COLOR_STOPS.map((color, index) => ({
    color,
    value: min + ((max - min) * index) / (COLOR_STOPS.length - 1)
  }));
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16)
  ];
}

function interpolateChannel(start: number, end: number, factor: number): number {
  return Math.round(start + (end - start) * factor);
}
