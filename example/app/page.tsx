import { Avatar } from "@/app/components/avatar";
import { AvatarGroup } from "@/app/components/avatar-group";

const SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
const SHAPES = ["circle", "square"] as const;
const STATUSES = ["online", "away", "offline"] as const;

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 p-12 dark:bg-black">
      <div className="mx-auto flex max-w-4xl flex-col gap-12">
        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Sizes — initials</h2>
          <div className="flex items-end gap-4">
            {SIZES.map((s) => (
              <Avatar key={s} name="Hugh Francis" size={s} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Sizes — image</h2>
          <div className="flex items-end gap-4">
            {SIZES.map((s) => (
              <Avatar
                key={s}
                name="Ada Lovelace"
                src="https://i.pravatar.cc/128?img=47"
                size={s}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Image — shapes + status</h2>
          <div className="flex items-center gap-4">
            <Avatar name="Linus Torvalds" src="https://i.pravatar.cc/128?img=12" size="lg" />
            <Avatar
              name="Margaret Hamilton"
              src="https://i.pravatar.cc/128?img=44"
              size="lg"
              shape="square"
            />
            <Avatar
              name="Grace Hopper"
              src="https://i.pravatar.cc/128?img=32"
              size="lg"
              status="online"
            />
            <Avatar
              name="Hugh Francis"
              src="https://i.pravatar.cc/128?img=68"
              size="lg"
              shape="square"
              status="away"
            />
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Shapes</h2>
          <div className="flex items-center gap-4">
            {SHAPES.map((shape) => (
              <Avatar key={shape} name="Ada Lovelace" shape={shape} size="lg" />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Status</h2>
          <div className="flex items-center gap-4">
            {STATUSES.map((status) => (
              <Avatar key={status} name="Grace Hopper" status={status} size="lg" />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Brand surface — gold</h2>
          <div className="rounded-2xl bg-brand-surface p-6">
            <div className="mb-3 text-xs font-medium tracking-wide text-brand-on-surface uppercase">
              Featured members
            </div>
            <AvatarGroup size="lg" surface="brand" max={3}>
              <Avatar name="Ada Lovelace" src="https://i.pravatar.cc/128?img=47" />
              <Avatar name="Linus Torvalds" src="https://i.pravatar.cc/128?img=12" />
              <Avatar name="Grace Hopper" src="https://i.pravatar.cc/128?img=32" status="online" />
              <Avatar name="Margaret Hamilton" src="https://i.pravatar.cc/128?img=44" />
              <Avatar name="Hugh Francis" src="https://i.pravatar.cc/128?img=68" />
            </AvatarGroup>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-sm font-medium text-zinc-500">Group</h2>
          <div className="flex flex-col gap-4">
            <AvatarGroup size="md">
              <Avatar name="Hugh Francis" />
              <Avatar name="Ada Lovelace" />
              <Avatar name="Grace Hopper" />
            </AvatarGroup>
            <AvatarGroup size="md" max={3}>
              <Avatar name="Hugh Francis" />
              <Avatar name="Ada Lovelace" />
              <Avatar name="Grace Hopper" />
              <Avatar name="Linus Torvalds" />
              <Avatar name="Margaret Hamilton" />
            </AvatarGroup>
            <AvatarGroup size="md" max={3}>
              <Avatar name="Ada Lovelace" src="https://i.pravatar.cc/128?img=47" />
              <Avatar name="Linus Torvalds" src="https://i.pravatar.cc/128?img=12" />
              <Avatar name="Grace Hopper" src="https://i.pravatar.cc/128?img=32" />
              <Avatar name="Margaret Hamilton" src="https://i.pravatar.cc/128?img=44" />
              <Avatar name="Hugh Francis" src="https://i.pravatar.cc/128?img=68" />
            </AvatarGroup>
          </div>
        </section>
      </div>
    </div>
  );
}
