export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
export type AvatarShape = "circle" | "square";

export interface AvatarProps {
  name: string;
  src?: string;
  size?: AvatarSize;
  shape?: AvatarShape;
  status?: "online" | "away" | "offline";
  count?: number;
  hidden?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
}

export function Avatar({ name, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
