// The header every top-level view opens with: a kicker led by a small ink square,
// the page heading, an optional lead line and the view's actions.

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
      <div>
        <p className="kicker">
          <span className="kicker-mark" aria-hidden="true" />
          {kicker}
        </p>
        <h1>{title}</h1>
        {lead && <p className="page-header-lead">{lead}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
