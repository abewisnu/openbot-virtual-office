import { avatarSpec, type AvatarSpec } from '../office/Avatar';
import type { Employee } from '../types';

/** Canvas ink, kept fixed: the office art is not part of the UI theme. */
const INK = '#14121c';

/** 12x12 pixel grid, drawn as SVG rects so it stays crisp at any size. */
const GRID = 12;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

function headRects(shape: AvatarSpec['shape'], tint: string): Rect[] {
  switch (shape) {
    case 'round':
      // Square with the four corners taken off.
      return [
        { x: 2, y: 3, w: 8, h: 6, fill: tint },
        { x: 3, y: 2, w: 6, h: 1, fill: tint },
        { x: 3, y: 9, w: 6, h: 1, fill: tint },
      ];
    case 'tall':
      return [{ x: 3, y: 1, w: 6, h: 10, fill: tint }];
    case 'wide':
      return [{ x: 1, y: 3, w: 10, h: 6, fill: tint }];
    case 'square':
    default:
      return [{ x: 2, y: 2, w: 8, h: 8, fill: tint }];
  }
}

function hairRects(hair: AvatarSpec['hair']): Rect[] {
  switch (hair) {
    case 'flat':
      return [{ x: 3, y: 1, w: 6, h: 1, fill: INK }];
    case 'spike':
      return [
        { x: 4, y: 1, w: 1, h: 1, fill: INK },
        { x: 6, y: 1, w: 1, h: 1, fill: INK },
      ];
    case 'side':
      return [{ x: 3, y: 1, w: 2, h: 2, fill: INK }];
    case 'cap':
      return [
        { x: 2, y: 2, w: 8, h: 1, fill: INK },
        { x: 2, y: 3, w: 1, h: 1, fill: INK },
      ];
    case 'none':
    default:
      return [];
  }
}

function faceRects(expression: AvatarSpec['expression']): Rect[] {
  const eyes: Rect[] = [
    { x: 4, y: 5, w: 1, h: 1, fill: INK },
    { x: 7, y: 5, w: 1, h: 1, fill: INK },
  ];
  switch (expression) {
    case 'smile':
      return [...eyes, { x: 5, y: 7, w: 2, h: 1, fill: INK }, { x: 4, y: 6, w: 1, h: 1, fill: INK }, { x: 7, y: 6, w: 1, h: 1, fill: INK }];
    case 'focused':
      return [...eyes, { x: 4, y: 4, w: 1, h: 1, fill: INK }, { x: 7, y: 4, w: 1, h: 1, fill: INK }, { x: 4, y: 7, w: 4, h: 1, fill: INK }];
    case 'surprised':
      return [...eyes, { x: 5, y: 7, w: 2, h: 2, fill: INK }];
    case 'tired':
      return [
        { x: 4, y: 5, w: 2, h: 1, fill: INK },
        { x: 6, y: 5, w: 1, h: 1, fill: INK },
        { x: 7, y: 5, w: 1, h: 1, fill: INK },
        { x: 4, y: 7, w: 3, h: 1, fill: INK },
        { x: 7, y: 8, w: 1, h: 1, fill: INK },
      ];
    case 'calm':
    default:
      return [...eyes, { x: 5, y: 7, w: 2, h: 1, fill: INK }];
  }
}

function accessoryRects(accessory: AvatarSpec['accessory']): Rect[] {
  switch (accessory) {
    case 'glasses':
      return [{ x: 3, y: 5, w: 6, h: 1, fill: INK }];
    case 'headset':
      return [
        { x: 1, y: 4, w: 1, h: 5, fill: INK },
        { x: 2, y: 4, w: 1, h: 1, fill: INK },
        { x: 2, y: 8, w: 1, h: 1, fill: INK },
      ];
    case 'none':
    default:
      return [];
  }
}

/**
 * The agent's pixel face, computed from `avatarSeed` alone. Same seed, same
 * face; nothing is fetched and nothing is persisted.
 */
export default function Avatar({
  employee,
  size = 56,
}: {
  employee: Pick<Employee, 'id' | 'name' | 'avatarSeed' | 'avatarColor' | 'avatarHue'>;
  size?: number;
}) {
  const spec = avatarSpec({
    seed: employee.avatarSeed,
    hue: employee.avatarHue,
    color: employee.avatarColor,
    fallbackSeed: employee.id,
  });
  const rects = [
    ...headRects(spec.shape, spec.tint),
    ...hairRects(spec.hair),
    ...faceRects(spec.expression),
    ...accessoryRects(spec.accessory),
  ];
  return (
    <div className="avatar" title={`${employee.name} avatar`}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${GRID} ${GRID}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`${employee.name} avatar`}
      >
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill} />
        ))}
      </svg>
    </div>
  );
}
