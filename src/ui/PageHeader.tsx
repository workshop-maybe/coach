// The header a view opens with: the headline standing alone (no kicker, R3), the
// view's actions beside it, and one line of prose under it.

import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, lead, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <h1>{title}</h1>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {lead && <p className="page-header-lead">{lead}</p>}
    </header>
  );
}
