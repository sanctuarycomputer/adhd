import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Avatar, SHAPE, SIZE_BOX, SIZE_TEXT, type AvatarSize } from "../avatar";

export type AvatarGroupSurface = "default" | "brand";

export interface AvatarGroupProps {
  children: ReactNode;
  size?: AvatarSize;
  max?: number;
  surface?: AvatarGroupSurface;
  className?: string;
}

const OVERLAP: Record<AvatarSize, string> = {
  xs: "-space-x-1",
  sm: "-space-x-1",
  md: "-space-x-2",
  lg: "-space-x-2",
  xl: "-space-x-3",
};

const SURFACE_RING: Record<AvatarGroupSurface, string> = {
  default: "[&>*]:ring-white dark:[&>*]:ring-zinc-950",
  brand: "[&>*]:ring-brand-surface",
};

const SURFACE_OVERFLOW: Record<AvatarGroupSurface, string> = {
  default: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  brand: "bg-brand-surface-raised text-brand-on-surface",
};

export function AvatarGroup({
  children,
  size = "md",
  max,
  surface = "default",
  className = "",
}: AvatarGroupProps) {
  const all = Children.toArray(children);
  const truncated = max != null && all.length > max;
  const visible = truncated ? all.slice(0, max) : all;
  const overflow = truncated ? all.length - max : 0;

  const items = visible.map((child) => {
    if (isValidElement(child) && child.type === Avatar) {
      return cloneElement(child as ReactElement<{ size?: AvatarSize }>, {
        size,
      });
    }
    return child;
  });

  return (
    <div
      className={`flex items-center ${OVERLAP[size]} [&>*]:ring-2 ${SURFACE_RING[surface]} ${className}`}
    >
      {items}
      {overflow > 0 && (
        <span
          className={`relative inline-flex items-center justify-center font-medium ${SIZE_BOX[size]} ${SHAPE.circle[size]} ${SIZE_TEXT[size]} ${SURFACE_OVERFLOW[surface]}`}
          aria-label={`${overflow} more`}
          role="img"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
