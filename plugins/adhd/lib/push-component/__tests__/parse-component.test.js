'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseComponent } = require('../parse-component');

const AVATAR_SOURCE = `
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

export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return <span>{name}</span>;
}
`;

test('parses exported union-type aliases', () => {
  const parsed = parseComponent(AVATAR_SOURCE);
  assert.deepEqual(parsed.unions.AvatarSize, ['xs', 'sm', 'md', 'lg', 'xl']);
  assert.deepEqual(parsed.unions.AvatarShape, ['circle', 'square']);
  assert.deepEqual(parsed.unions.AvatarStatus, ['online', 'away', 'offline']);
});

test('parses the props interface and classifies each prop', () => {
  const parsed = parseComponent(AVATAR_SOURCE);
  assert.equal(parsed.componentName, 'Avatar');
  assert.equal(parsed.props.name.type, 'string');
  assert.equal(parsed.props.name.optional, false);
  assert.equal(parsed.props.src.type, 'string');
  assert.equal(parsed.props.src.optional, true);
  assert.equal(parsed.props.size.type, 'union');
  assert.equal(parsed.props.size.unionName, 'AvatarSize');
  assert.equal(parsed.props.size.optional, true);
  assert.equal(parsed.props.shape.type, 'union');
  assert.equal(parsed.props.status.type, 'union');
  assert.equal(parsed.props.className.type, 'string');
  assert.equal(parsed.props.className.optional, true);
});

test('handles type aliases as well as interfaces for the props', () => {
  const SOURCE = `
    type ButtonProps = { onClick: () => void; label: string };
    export function Button({ onClick, label }: ButtonProps) {
      return <button onClick={onClick}>{label}</button>;
    }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.componentName, 'Button');
  assert.equal(parsed.props.onClick.type, 'function');
  assert.equal(parsed.props.label.type, 'string');
});

test('recognizes function-typed props by syntactic form', () => {
  const SOURCE = `
    interface Props {
      onClick: (event: React.MouseEvent) => void;
      onChange?: () => void;
    }
    export function Foo({ onClick }: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.onClick.type, 'function');
  assert.equal(parsed.props.onChange.type, 'function');
});

test('recognizes ref-typed props', () => {
  const SOURCE = `
    interface Props {
      inputRef: React.Ref<HTMLInputElement>;
      otherRef?: RefObject<HTMLDivElement>;
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.inputRef.type, 'ref');
  assert.equal(parsed.props.otherRef.type, 'ref');
});

test('recognizes ReactNode children', () => {
  const SOURCE = `
    interface Props {
      children: React.ReactNode;
      content?: ReactElement;
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.children.type, 'reactnode');
  assert.equal(parsed.props.content.type, 'reactnode');
});

test('inline union types are captured', () => {
  const SOURCE = `
    interface Props {
      variant: "primary" | "secondary";
    }
    export function Foo({}: Props) { return null; }
  `;
  const parsed = parseComponent(SOURCE);
  assert.equal(parsed.props.variant.type, 'union');
  assert.deepEqual(parsed.props.variant.values, ['primary', 'secondary']);
});

test('aborts with a clear error when no exported component found', () => {
  const SOURCE = `const internal = 'just data';`;
  assert.throws(() => parseComponent(SOURCE), /No exported function component/);
});

test('aborts when props interface cannot be located', () => {
  const SOURCE = `
    export function Anonymous(props) { return null; }
  `;
  assert.throws(() => parseComponent(SOURCE), /Could not locate props/);
});
