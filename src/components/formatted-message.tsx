import { Fragment, type ReactNode } from "react";
import { formatMessageBlocks, type MessageBlock } from "@/lib/format-message";

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|__[^_]+__)/gu);

  return parts.map((part, index) => {
    const isBold =
      (part.startsWith("**") && part.endsWith("**")) ||
      (part.startsWith("__") && part.endsWith("__"));
    return isBold ? (
      <strong key={index}>{part.slice(2, -2)}</strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
}

function groupedBlocks(blocks: MessageBlock[]) {
  const result: ReactNode[] = [];
  let index = 0;

  while (index < blocks.length) {
    const block = blocks[index];

    if (block.type === "bullet") {
      const items: Extract<MessageBlock, { type: "bullet" }>[] = [];
      while (blocks[index]?.type === "bullet") {
        items.push(blocks[index] as Extract<MessageBlock, { type: "bullet" }>);
        index += 1;
      }
      result.push(
        <ul className="message-list" key={`bullet-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineText>{item.content}</InlineText>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (block.type === "number") {
      const items: Extract<MessageBlock, { type: "number" }>[] = [];
      while (blocks[index]?.type === "number") {
        items.push(blocks[index] as Extract<MessageBlock, { type: "number" }>);
        index += 1;
      }
      result.push(
        <ol className="message-list numbered" key={`number-${index}`}>
          {items.map((item, itemIndex) => (
            <li
              key={itemIndex}
              value={Number(item.number)}
              data-number={item.number}
            >
              <InlineText>{item.content}</InlineText>
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    if (block.type === "section") {
      result.push(
        <section className="message-section" key={`section-${index}`}>
          <h4>
            {block.marker && (
              <span className="message-section-icon" aria-hidden="true">
                {block.marker}
              </span>
            )}
            <InlineText>{block.title}</InlineText>
          </h4>
          {block.content && (
            <p>
              <InlineText>{block.content}</InlineText>
            </p>
          )}
        </section>,
      );
    } else {
      result.push(
        <p className="message-paragraph" key={`paragraph-${index}`}>
          <InlineText>{block.content}</InlineText>
        </p>,
      );
    }
    index += 1;
  }

  return result;
}

export function FormattedMessage({ children }: { children: string }) {
  return (
    <div className="formatted-message">
      {groupedBlocks(formatMessageBlocks(children))}
    </div>
  );
}
