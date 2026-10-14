import type { ReactNode } from "react";

import {
  resolveHref,
  type Block,
  type Inline,
  type TemplateValues,
} from "@/core/notifications/markup";

/**
 * Preview of a template body (CF3b), drawn from the parsed tree as React
 * elements: React escapes every text, no HTML string is ever injected, and
 * a link appears only when its address is a safe http(s) one. Links and
 * headings take the brand's primary token, as on the partner's host.
 */

function inlines(
  nodes: readonly Inline[],
  values: TemplateValues,
): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "tag":
        return (
          <span key={index} data-testid="preview-tag">
            {values[node.name] ?? ""}
          </span>
        );
      case "break":
        return <br key={index} />;
      case "strong":
        return <strong key={index}>{inlines(node.children, values)}</strong>;
      case "em":
        return <em key={index}>{inlines(node.children, values)}</em>;
      case "link": {
        const href = resolveHref(node.href, values);
        const label = inlines(node.children, values);
        return href ? (
          <a
            key={index}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {label.length > 0 ? label : href}
          </a>
        ) : (
          <span key={index}>{label}</span>
        );
      }
    }
  });
}

export function MarkupPreview({
  blocks,
  values,
}: Readonly<{
  blocks: readonly Block[];
  values: TemplateValues;
}>) {
  return (
    <div className="text-14 text-text space-y-3 break-words">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const content = inlines(block.children, values);
            if (block.level === 1) {
              return (
                <h1 key={index} className="text-20 text-primary font-semibold">
                  {content}
                </h1>
              );
            }
            if (block.level === 2) {
              return (
                <h2 key={index} className="text-16 text-primary font-semibold">
                  {content}
                </h2>
              );
            }
            return (
              <h3 key={index} className="text-14 text-primary font-semibold">
                {content}
              </h3>
            );
          }
          case "paragraph":
            return <p key={index}>{inlines(block.children, values)}</p>;
          case "list": {
            const items = block.items.map((item, i) => (
              <li key={i}>{inlines(item, values)}</li>
            ));
            return block.ordered ? (
              <ol key={index} className="list-decimal space-y-1 pl-5">
                {items}
              </ol>
            ) : (
              <ul key={index} className="list-disc space-y-1 pl-5">
                {items}
              </ul>
            );
          }
        }
      })}
    </div>
  );
}
