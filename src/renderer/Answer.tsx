import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
function Answer({ text, onLink }: { text: string; onLink: (url: string) => void }): React.JSX.Element {
  return <div className="answer"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ href, children }) => href && /^https?:\/\//i.test(href) ? <button className="inline-link" onClick={() => onLink(href)}>{children}</button> : <span>{children}</span>,
    img: ({ alt }) => alt ? <span className="muted">{alt}</span> : null,
  }}>{text}</ReactMarkdown></div>;
}
export default memo(Answer);
