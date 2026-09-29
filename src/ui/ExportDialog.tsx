// Placeholder with the final props contract. U10 replaces the body.
export interface ExportDialogProps {
  collectionSlug: string;
  onClose(): void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  return (
    <section aria-label="Export">
      <button type="button" onClick={onClose}>Close</button>
    </section>
  );
}
