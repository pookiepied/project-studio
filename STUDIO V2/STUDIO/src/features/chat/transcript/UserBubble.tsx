import { CollapsibleText } from '@/features/chat/transcript/CollapsibleText'

/**
 * A message from the user.
 *
 * The user gets a bubble and the assistant does not: the bubble marks the
 * short, authored side of the conversation, while the assistant's longer output
 * reads better as plain prose in the column.
 *
 * `max-w` keeps the bubble off the full column width and `min-w-0` lets it
 * shrink below its content; the wrapping itself is handled by
 * `CollapsibleText`, which also clamps long pastes.
 */
export function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="min-w-0 max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 sm:max-w-[75%]">
        <CollapsibleText text={text} />
      </div>
    </div>
  )
}
