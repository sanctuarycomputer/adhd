import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Avatar, type AvatarSize } from "../avatar";

export interface AvatarGroupProps {
  children: ReactNode;
  size?: AvatarSize;
  className?: string;
}

const OVERLAP: Record<AvatarSize, string> = {
  xs: "-space-x-1",
  sm: "-space-x-1",
  md: "-space-x-2",
  lg: "-space-x-2",
  xl: "-space-x-3",
};

export function AvatarGroup({
  children,
  size = "md",
  className = "",
}: AvatarGroupProps) {
  const items = Children.toArray(children).map((child) => {
    if (isValidElement(child) && child.type === Avatar) {
      return cloneElement(child as ReactElement<{ size?: AvatarSize }>, {
        size,
      });
    }
    return child;
  });

  return (
    <div
      className={`flex items-center ${OVERLAP[size]} [&>*]:ring-2 [&>*]:ring-white dark:[&>*]:ring-zinc-950 ${className}`}
    >
      {items}
    </div>
  );
}
