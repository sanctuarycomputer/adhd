import Image from "next/image";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";
export type AvatarStatus = "online" | "away" | "offline";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  status?: AvatarStatus;
  className?: string;
}

export const SIZE_BOX: Record<AvatarSize, string> = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-12 w-12",
  xl: "h-16 w-16",
};

const SIZE_PX: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

export const SIZE_TEXT: Record<AvatarSize, string> = {
  xs: "text-2xs",
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
  xl: "text-lg",
};

export const SHAPE: Record<AvatarShape, Record<AvatarSize, string>> = {
  circle: {
    xs: "rounded-full",
    sm: "rounded-full",
    md: "rounded-full",
    lg: "rounded-full",
    xl: "rounded-full",
  },
  square: {
    xs: "rounded-md",
    sm: "rounded-md",
    md: "rounded-lg",
    lg: "rounded-lg",
    xl: "rounded-lg",
  },
};

const STATUS_DOT: Record<AvatarSize, string> = {
  xs: "h-[6px] w-[6px]",
  sm: "h-[8px] w-[8px]",
  md: "h-[10px] w-[10px]",
  lg: "h-[12px] w-[12px]",
  xl: "h-[14px] w-[14px]",
};

const STATUS_COLOR: Record<AvatarStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-zinc-400",
};

const PALETTE = [
  "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200",
  "bg-neutral-300 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100",
  "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-200",
  "bg-zinc-300 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function getPaletteIndex(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return sum % PALETTE.length;
}

export function Avatar({
  name,
  src,
  size = "md",
  shape = "circle",
  status,
  className = "",
}: AvatarProps) {
  const box = SIZE_BOX[size];
  const radius = SHAPE[shape][size];
  const px = SIZE_PX[size];
  const palette = PALETTE[getPaletteIndex(name)];

  return (
    <span
      role="img"
      aria-label={status ? `${name}, ${status}` : name}
      className={`relative inline-block ${box} ${radius} ${className}`}
    >
      <span className={`block h-full w-full overflow-hidden ${radius}`}>
        {src ? (
          <Image
            src={src}
            alt=""
            width={px}
            height={px}
            sizes={`${px}px`}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className={`flex h-full w-full items-center justify-center font-medium uppercase select-none ${SIZE_TEXT[size]} ${palette}`}
          >
            {getInitials(name)}
          </span>
        )}
      </span>
      {status && (
        <span
          aria-hidden="true"
          className={`absolute right-0 bottom-0 rounded-full ring-2 ring-white dark:ring-zinc-950 ${STATUS_DOT[size]} ${STATUS_COLOR[status]}`}
        />
      )}
    </span>
  );
}
