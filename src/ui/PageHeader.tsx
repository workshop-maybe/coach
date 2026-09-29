// The header every top-level view opens with, as a scene opens in the andamio-coach
// world: a kicker led by an ink square and followed by a rule, the headline, the
// view's actions beside it, and one line of prose under it.

import type { ReactNode } from "react";

export interface PageHeaderProps {
  kicker: string;
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ kicker, title, lead, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <p className="kicker">
        <span className="kicker-mark" aria-hidden="true" />
        {kicker}
      </p>
      <div className="page-header-row">
        <h1>{title}</h1>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {lead && <p className="page-header-lead">{lead}</p>}
    </header>
  );
}
